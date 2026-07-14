#!/bin/sh

set -eu

script_directory=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repository_root=$(dirname "$script_directory")
output_directory="$repository_root/tests"
staging_directory=""
redact_device_names=1

usage() {
  cat <<EOF
Usage: scripts/generate-test-data.sh [--output-dir DIRECTORY] [--no-redact-device-names]

Capture the read-only ZFS command output used by nazboard's test fixtures.
Leaf device names in zpool status output are redacted by default.
The output directory defaults to $output_directory.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      if [ "$#" -lt 2 ]; then
        printf '%s\n\n' "Missing directory after --output-dir." >&2
        usage >&2
        exit 2
      fi
      output_directory=$2
      shift 2
      ;;
    --no-redact-device-names)
      redact_device_names=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for command_name in zpool zfs; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf "Required command '%s' was not found in PATH.\n" "$command_name" >&2
    exit 1
  fi
done

if [ "$redact_device_names" -eq 1 ] && ! command -v awk >/dev/null 2>&1; then
  printf "Required command 'awk' was not found in PATH.\n" >&2
  exit 1
fi

cleanup() {
  if [ -n "$staging_directory" ]; then
    rm -rf "$staging_directory"
  fi
}

trap cleanup 0
trap 'exit 1' HUP INT TERM

staging_directory=$(mktemp -d "${TMPDIR:-/tmp}/nazboard-test-data.XXXXXX")

# Capture everything first so a failed command leaves existing fixtures alone.
zpool status -x >"$staging_directory/zpool_status_x.raw"
zpool list -H -o name,size,alloc,free,health >"$staging_directory/zpool_list.txt"
zpool status >"$staging_directory/zpool_status.raw"
zfs list -H -p -o name,used,avail,refer,mountpoint,usedbysnapshots \
  >"$staging_directory/zfs_list.txt"
zfs list -H -p -t snapshot -o name,used,refer,creation \
  >"$staging_directory/zfs_snapshots.txt"
while IFS= read -r line; do
  set -- $line
  dataset_name=${1:-}
  if [ -z "$dataset_name" ] || [ "$dataset_name" = "NAME" ]; then
    continue
  fi

  fixture_name=$(printf '%s' "$dataset_name" | sed 's/[^A-Za-z0-9._-]/_/g')
  zfs get -H -p -o name,property,value,source all "$dataset_name" \
    >"$staging_directory/zfs_get_all_$fixture_name.txt"
done <"$staging_directory/zfs_list.txt"

if [ "$redact_device_names" -eq 1 ]; then
  awk \
    -v full_raw="$staging_directory/zpool_status.raw" \
    -v full_output="$staging_directory/zpool_status.txt" \
    -v health_output="$staging_directory/zpool_status_x.txt" \
    '
      function emit(line) {
        if (FILENAME == full_raw) {
          print line > full_output
        } else {
          print line > health_output
        }
      }

      FNR == 1 {
        in_config = 0
        root_seen = 0
      }

      $1 == "NAME" && $2 == "STATE" {
        in_config = 1
        root_seen = 0
        emit($0)
        next
      }

      in_config && $1 == "errors:" {
        in_config = 0
        emit($0)
        next
      }

      in_config && $2 ~ /^(ONLINE|DEGRADED|FAULTED|OFFLINE|UNAVAIL|REMOVED|AVAIL|INUSE)$/ {
        name = $1
        if (!root_seen) {
          root_seen = 1
        } else if (name !~ /^(mirror-[0-9]+|raidz[0-9]*-[0-9]+|draid[^[:space:]]*-[0-9]+|replacing-[0-9]+|spare-[0-9]+)$/) {
          if (!(name in redacted_names)) {
            redacted_names[name] = "disk-" ++redacted_count
          }
          match($0, /[^[:space:]]+/)
          emit(substr($0, 1, RSTART - 1) redacted_names[name] substr($0, RSTART + RLENGTH))
          next
        }
      }

      { emit($0) }
    ' \
    "$staging_directory/zpool_status.raw" \
    "$staging_directory/zpool_status_x.raw"
else
  cp "$staging_directory/zpool_status.raw" "$staging_directory/zpool_status.txt"
  cp "$staging_directory/zpool_status_x.raw" "$staging_directory/zpool_status_x.txt"
fi

mkdir -p "$output_directory"

for filename in \
  zpool_status_x.txt \
  zpool_list.txt \
  zpool_status.txt \
  zfs_list.txt \
  zfs_snapshots.txt
do
  cp "$staging_directory/$filename" "$output_directory/$filename"
  printf 'Wrote %s/%s\n' "$output_directory" "$filename"
done

for filename in "$staging_directory"/zfs_get_all_*.txt; do
  [ -e "$filename" ] || continue
  cp "$filename" "$output_directory/$(basename "$filename")"
  printf 'Wrote %s/%s\n' "$output_directory" "$(basename "$filename")"
done

if [ "$redact_device_names" -eq 1 ]; then
  printf '%s\n' \
    'Device names were redacted; review pool, dataset, and other host-specific names before committing.'
else
  printf '%s\n' \
    'Device names were not redacted; review all host-specific names before committing.'
fi
