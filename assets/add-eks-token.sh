#!/bin/sh

debug() {
  if [ "${ADD_EKS_DEBUG:-}" = "1" ]; then
    printf 'add-eks-token: %s\n' "$*" >&2
  fi
}

fatal() {
  printf 'add-eks-token: %s\n' "$*" >&2
  exit 1
}

need_value() {
  opt=$1
  value=${2-}
  if [ "$value" = "" ]; then
    fatal "$opt requires a value"
  fi
  case "$value" in
    --*) fatal "$opt requires a value" ;;
  esac
}

safe_name() {
  printf '%s' "$1" | sed 's/[^A-Za-z0-9._-]/_/g'
}

safe_prefix() {
  value=$(safe_name "$1" | cut -c 1-80)
  if [ "$value" = "" ]; then
    printf 'key'
  else
    printf '%s' "$value"
  fi
}

expiration_timestamp() {
  sed -n 's/.*"expirationTimestamp"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n '1p'
}

format_epoch() {
  epoch=$1

  formatted=$(date -u -d "@$epoch" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
  if [ "$formatted" = "" ]; then
    formatted=$(date -u -r "$epoch" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
  fi

  case "$formatted" in
    ????-??-??T??:??:??Z) printf '%s\n' "$formatted" ;;
    *) return 1 ;;
  esac
}

timestamp_epoch() {
  ts=$1
  normalized=$(printf '%s' "$ts" | sed 's/\.[0-9][0-9]*Z$/Z/')

  case "$normalized" in
    ????-??-??T??:??:??Z) ;;
    *) return 1 ;;
  esac

  epoch=$(date -u -d "$normalized" +%s 2>/dev/null)
  if [ "$epoch" = "" ]; then
    epoch=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$normalized" +%s 2>/dev/null)
  fi

  case "$epoch" in
    ''|*[!0-9]*) return 1 ;;
  esac

  round_trip=$(format_epoch "$epoch") || return 1
  if [ "$round_trip" != "$normalized" ]; then
    return 1
  fi

  printf '%s\n' "$epoch"
}

current_millis() {
  millis=$(date -u +%s%3N 2>/dev/null)
  case "$millis" in
    ''|*[!0-9]*) ;;
    *) printf '%s\n' "$millis"; return 0 ;;
  esac

  epoch=$(date -u +%s 2>/dev/null)
  case "$epoch" in
    ''|*[!0-9]*) printf '0\n' ;;
    *) printf '%s\n' $((epoch * 1000)) ;;
  esac
}

elapsed_millis() {
  start_ms=$1
  end_ms=$2

  case "$start_ms:$end_ms" in
    *[!0-9:]*|:*) printf '0\n'; return 0 ;;
  esac
  if [ "$end_ms" -ge "$start_ms" ]; then
    printf '%s\n' $((end_ms - start_ms))
  else
    printf '0\n'
  fi
}

profile_cache_label() {
  if [ "${profile:-}" != "" ]; then
    printf '%s' "$profile"
  else
    printf 'ambient'
  fi
}

is_cluster_arn() {
  case "$1" in
    arn:aws:eks:*:*:cluster/*|arn:aws-us-gov:eks:*:*:cluster/*|arn:aws-cn:eks:*:*:cluster/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

cache_key_value() {
  profile_label=$(profile_cache_label)

  case "$cache_key" in
    cluster)
      printf '%s' "$cluster"
      ;;
    cluster-profile)
      printf '%s__%s' "$cluster" "$profile_label"
      ;;
    cluster-region-profile)
      printf '%s__%s__%s' "$cluster" "$region" "$profile_label"
      ;;
    arn)
      if [ "${arn:-}" != "" ]; then
        printf '%s' "$arn"
      else
        case "$cluster" in
          arn:*) printf '%s' "$cluster" ;;
          *)
            debug 'cache key arn requested without arn value; using cluster-region-profile'
            printf '%s__%s__%s' "$cluster" "$region" "$profile_label"
            ;;
        esac
      fi
      ;;
    *)
      debug "unsupported cache key '$cache_key'; using cluster-region-profile"
      printf '%s__%s__%s' "$cluster" "$region" "$profile_label"
      ;;
  esac
}

write_profile_identity_material() {
  if [ "${profile:-}" != "" ]; then
    printf 'profile=%s\n' "$profile"
  else
    printf 'profile=ambient\n'
  fi

  found=0
  if [ "${AWS_PROFILE:-}" != "" ]; then
    printf 'env_AWS_PROFILE=%s\n' "$AWS_PROFILE"
    found=1
  fi
  if [ "${AWS_DEFAULT_PROFILE:-}" != "" ]; then
    printf 'env_AWS_DEFAULT_PROFILE=%s\n' "$AWS_DEFAULT_PROFILE"
    found=1
  fi
  if [ "${AWS_SHARED_CREDENTIALS_FILE:-}" != "" ]; then
    printf 'env_AWS_SHARED_CREDENTIALS_FILE=%s\n' "$AWS_SHARED_CREDENTIALS_FILE"
    found=1
  fi
  if [ "${AWS_CONFIG_FILE:-}" != "" ]; then
    printf 'env_AWS_CONFIG_FILE=%s\n' "$AWS_CONFIG_FILE"
    found=1
  fi
  if [ "${AWS_ACCESS_KEY_ID:-}" != "" ]; then
    printf 'env_AWS_ACCESS_KEY_ID=%s\n' "$AWS_ACCESS_KEY_ID"
    found=1
  fi
  if [ "${AWS_ROLE_ARN:-}" != "" ]; then
    printf 'env_AWS_ROLE_ARN=%s\n' "$AWS_ROLE_ARN"
    found=1
  fi
  if [ "${AWS_WEB_IDENTITY_TOKEN_FILE:-}" != "" ]; then
    printf 'env_AWS_WEB_IDENTITY_TOKEN_FILE=%s\n' "$AWS_WEB_IDENTITY_TOKEN_FILE"
    found=1
  fi

  if [ "$found" -eq 0 ] && [ "${profile:-}" = "" ]; then
    printf 'ambient=none\n'
  fi
}

cache_key_material() {
  key_value=$1

  printf 'strategy=%s\n' "$cache_key"
  printf 'value=%s\n' "$key_value"
  write_profile_identity_material
  if [ "${arn:-}" != "" ] && is_cluster_arn "$arn"; then
    printf 'cluster_arn=%s\n' "$arn"
  fi
  printf 'role_arn=%s\n' "${role_arn:-}"
}

cache_file_name() {
  key_value=$1
  key_material=$(cache_key_material "$key_value")
  set -- $(printf '%s' "$key_material" | cksum)
  cache_hash=$1-$2
  prefix=$(safe_prefix "$cache_key-$(safe_name "$key_value")")

  printf '%s-%s.json\n' "$prefix" "$cache_hash"
}

stats_bucket_key() {
  profile_label=$(profile_cache_label)
  safe_prefix "$(safe_name "$cluster")__$(safe_name "$region")__$(safe_name "$profile_label")"
}

stats_file_is_valid() {
  file=$1

  [ -f "$file" ] || return 0
  awk '
    BEGIN {
      state = 1
      recent_count = 0
      recent_comma = 0
      bucket_count = 0
      bucket_comma = 0
    }
    function fail() {
      ok = 0
      exit 1
    }
    state == 1 {
      if ($0 != "{") fail()
      state = 2
      next
    }
    state == 2 {
      if ($0 != "\"schemaVersion\":1,") fail()
      state = 3
      next
    }
    state == 3 {
      if ($0 != "\"totals\":{") fail()
      state = 4
      next
    }
    state == 4 {
      if ($0 !~ /^"hits":[0-9]+,$/) fail()
      state = 5
      next
    }
    state == 5 {
      if ($0 !~ /^"misses":[0-9]+,$/) fail()
      state = 6
      next
    }
    state == 6 {
      if ($0 !~ /^"awsCalls":[0-9]+,$/) fail()
      state = 7
      next
    }
    state == 7 {
      if ($0 !~ /^"estimatedSavedMs":[0-9]+,$/) fail()
      state = 8
      next
    }
    state == 8 {
      if ($0 !~ /^"actualAwsMsTotal":[0-9]+$/) fail()
      state = 9
      next
    }
    state == 9 {
      if ($0 != "},") fail()
      state = 10
      next
    }
    state == 10 {
      if ($0 != "\"byCluster\":{") fail()
      state = 11
      next
    }
    state == 11 && $0 == "}," {
      if (bucket_count > 0 && bucket_comma == 1) fail()
      state = 13
      next
    }
    state == 11 {
      if (bucket_count > 0 && bucket_comma == 0) fail()
      if ($0 !~ /^"[A-Za-z0-9._-]+":[{]"hits":[0-9]+,"misses":[0-9]+,"estimatedSavedMs":[0-9]+[}],?$/) fail()
      bucket_count++
      bucket_comma = ($0 ~ /,$/) ? 1 : 0
      next
    }
    state == 13 {
      if ($0 != "\"recent\":[") fail()
      state = 14
      next
    }
    state == 14 && $0 == "]" {
      if (recent_count > 0 && recent_comma == 1) fail()
      state = 15
      next
    }
    state == 14 {
      if (recent_count > 0 && recent_comma == 0) fail()
      if ($0 !~ /^[{]"type":"(hit|miss)","cluster":"[A-Za-z0-9._-]+","(actualAwsMs|estimatedSavedMs)":[0-9]+[}],?$/) fail()
      recent_count++
      recent_comma = ($0 ~ /,$/) ? 1 : 0
      next
    }
    state == 15 {
      if ($0 != "}") fail()
      state = 16
      next
    }
    {
      fail()
    }
    END {
      if (state != 16) {
        exit 1
      }
    }
  ' "$file" >/dev/null 2>&1
}

record_stats() {
  stats_type=$1
  stats_actual_ms=${2:-0}
  stats_file=$cache_dir/.add-eks-stats.json
  stats_lock=$stats_file.lock
  stats_tmp=$stats_file.$$.tmp
  stats_input=/dev/null
  stats_bucket=$(stats_bucket_key)

  case "$stats_actual_ms" in
    ''|*[!0-9]*) stats_actual_ms=0 ;;
  esac

  if ! mkdir "$stats_lock" 2>/dev/null; then
    debug 'stats update skipped: stats lock busy'
    return 0
  fi
  trap 'rm -f "$stats_tmp" 2>/dev/null; rmdir "$stats_lock" 2>/dev/null' HUP INT TERM EXIT

  if [ -f "$stats_file" ]; then
    if stats_file_is_valid "$stats_file"; then
      stats_input=$stats_file
    else
      if ! mv -f "$stats_file" "$stats_file.malformed" 2>/dev/null; then
        debug 'stats update skipped: failed to move malformed stats file aside'
        rmdir "$stats_lock" 2>/dev/null
        trap - HUP INT TERM EXIT
        return 0
      fi
    fi
  fi

  if ! awk -v event="$stats_type" -v actual_ms="$stats_actual_ms" -v bucket="$stats_bucket" '
    BEGIN {
      hits = 0
      misses = 0
      aws_calls = 0
      actual_total = 0
      estimated_total = 0
      recent_count = 0
      bucket_count = 0
    }
    function number_field(line, name, marker, value) {
      marker = "\"" name "\":"
      value = line
      sub("^.*" marker, "", value)
      sub("[^0-9].*$", "", value)
      if (value == "") {
        return 0
      }
      return value + 0
    }
    function clean_recent(line) {
      sub("^[[:space:]]*", "", line)
      sub(",$", "", line)
      return line
    }
    /^"totals":\{/ { in_totals = 1; next }
    in_totals && /^\},/ { in_totals = 0; next }
    in_totals && /^"hits":/ { hits = number_field($0, "hits") }
    in_totals && /^"misses":/ { misses = number_field($0, "misses") }
    in_totals && /^"awsCalls":/ { aws_calls = number_field($0, "awsCalls") }
    in_totals && /^"actualAwsMsTotal":/ { actual_total = number_field($0, "actualAwsMsTotal") }
    in_totals && /^"estimatedSavedMs":/ { estimated_total = number_field($0, "estimatedSavedMs") }
    /^"recent":\[/ { in_recent = 1; next }
    in_recent && /^\]/ { in_recent = 0; next }
    in_recent {
      recent[++recent_count] = clean_recent($0)
      next
    }
    /^"byCluster":\{/ { in_cluster = 1; next }
    in_cluster && /^\}/ { in_cluster = 0; next }
    in_cluster && /^"/ {
      line = $0
      key = line
      sub("^\"", "", key)
      sub("\":.*$", "", key)
      if (!(key in bucket_seen)) {
        bucket_order[++bucket_count] = key
        bucket_seen[key] = 1
      }
      bucket_hits[key] = number_field(line, "hits")
      bucket_misses[key] = number_field(line, "misses")
      bucket_estimated_total[key] = number_field(line, "estimatedSavedMs")
    }
    END {
      if (event == "hit") {
        saved_ms = aws_calls > 0 ? int(actual_total / aws_calls) : 2000
        hits++
        estimated_total += saved_ms
        new_recent = "{\"type\":\"hit\",\"cluster\":\"" bucket "\",\"estimatedSavedMs\":" saved_ms "}"
        bucket_hits[bucket]++
        bucket_estimated_total[bucket] += saved_ms
      } else {
        misses++
        aws_calls++
        actual_total += actual_ms
        new_recent = "{\"type\":\"miss\",\"cluster\":\"" bucket "\",\"actualAwsMs\":" actual_ms "}"
        bucket_misses[bucket]++
      }

      recent[++recent_count] = new_recent
      if (!(bucket in bucket_seen)) {
        bucket_order[++bucket_count] = bucket
        bucket_seen[bucket] = 1
      }

      while (recent_count > 50) {
        for (i = 1; i < recent_count; i++) {
          recent[i] = recent[i + 1]
        }
        delete recent[recent_count]
        recent_count--
      }
      while (bucket_count > 50) {
        delete_key = bucket_order[1]
        delete bucket_seen[delete_key]
        delete bucket_hits[delete_key]
        delete bucket_misses[delete_key]
        delete bucket_estimated_total[delete_key]
        for (i = 1; i < bucket_count; i++) {
          bucket_order[i] = bucket_order[i + 1]
        }
        delete bucket_order[bucket_count]
        bucket_count--
      }

      print "{"
      print "\"schemaVersion\":1,"
      print "\"totals\":{"
      print "\"hits\":" hits ","
      print "\"misses\":" misses ","
      print "\"awsCalls\":" aws_calls ","
      print "\"estimatedSavedMs\":" estimated_total ","
      print "\"actualAwsMsTotal\":" actual_total
      print "},"
      print "\"byCluster\":{"
      written = 0
      for (i = 1; i <= bucket_count; i++) {
        key = bucket_order[i]
        if (!(key in bucket_seen)) {
          continue
        }
        written++
        suffix = written < bucket_count ? "," : ""
        print "\"" key "\":{\"hits\":" bucket_hits[key] + 0 ",\"misses\":" bucket_misses[key] + 0 ",\"estimatedSavedMs\":" bucket_estimated_total[key] + 0 "}" suffix
      }
      print "},"
      print "\"recent\":["
      for (i = 1; i <= recent_count; i++) {
        suffix = i < recent_count ? "," : ""
        print recent[i] suffix
      }
      print "]"
      print "}"
    }
  ' "$stats_input" 2>/dev/null > "$stats_tmp"; then
    debug 'stats update skipped: failed to write temporary stats file'
    rm -f "$stats_tmp" 2>/dev/null
    rmdir "$stats_lock" 2>/dev/null
    trap - HUP INT TERM EXIT
    return 0
  fi

  if ! chmod 600 "$stats_tmp" 2>/dev/null; then
    debug 'stats update skipped: failed to set stats file mode'
    rm -f "$stats_tmp" 2>/dev/null
    rmdir "$stats_lock" 2>/dev/null
    trap - HUP INT TERM EXIT
    return 0
  fi
  if ! mv "$stats_tmp" "$stats_file" 2>/dev/null; then
    debug 'stats update skipped: failed to replace stats file'
    rm -f "$stats_tmp" 2>/dev/null
    rmdir "$stats_lock" 2>/dev/null
    trap - HUP INT TERM EXIT
    return 0
  fi
  rmdir "$stats_lock" 2>/dev/null
  trap - HUP INT TERM EXIT
}

read_cache_if_fresh() {
  file=$1

  if [ ! -f "$file" ]; then
    debug 'cache miss: cache file not found'
    return 1
  fi

  cached_json=$(cat "$file") || {
    debug 'cache miss: cache file unreadable'
    return 1
  }

  expires=$(printf '%s\n' "$cached_json" | expiration_timestamp)
  if [ "$expires" = "" ]; then
    debug 'cache miss: expirationTimestamp missing'
    return 1
  fi

  expires_epoch=$(timestamp_epoch "$expires")
  if [ "$expires_epoch" = "" ]; then
    debug "cache miss: expirationTimestamp unparseable: $expires"
    return 1
  fi

  now_epoch=$(date -u +%s 2>/dev/null)
  case "$now_epoch" in
    ''|*[!0-9]*)
      debug 'cache miss: current time unavailable'
      return 1
      ;;
  esac

  if [ "$expires_epoch" -le $((now_epoch + safety_margin)) ]; then
    debug 'cache miss: cached token expired or inside safety margin'
    return 1
  fi

  debug 'cache hit'
  printf '%s\n' "$cached_json"
  return 0
}

call_aws() {
  if [ "${profile:-}" != "" ] && [ "${role_arn:-}" != "" ]; then
    aws eks get-token --cluster-name "$cluster" --region "$region" --profile "$profile" --role-arn "$role_arn"
  elif [ "${profile:-}" != "" ]; then
    aws eks get-token --cluster-name "$cluster" --region "$region" --profile "$profile"
  elif [ "${role_arn:-}" != "" ]; then
    aws eks get-token --cluster-name "$cluster" --region "$region" --role-arn "$role_arn"
  else
    aws eks get-token --cluster-name "$cluster" --region "$region"
  fi
}

cluster=
region=
profile=
cache_dir=
safety_margin=60
cache_key=cluster-region-profile
arn=
role_arn=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cluster)
      need_value "$1" "${2-}"
      cluster=$2
      shift 2
      ;;
    --cluster=*)
      cluster=${1#--cluster=}
      shift
      ;;
    --cluster-name)
      need_value "$1" "${2-}"
      cluster=$2
      shift 2
      ;;
    --cluster-name=*)
      cluster=${1#--cluster-name=}
      shift
      ;;
    --region)
      need_value "$1" "${2-}"
      region=$2
      shift 2
      ;;
    --region=*)
      region=${1#--region=}
      shift
      ;;
    --profile)
      need_value "$1" "${2-}"
      profile=$2
      shift 2
      ;;
    --profile=*)
      profile=${1#--profile=}
      shift
      ;;
    --cache-dir)
      need_value "$1" "${2-}"
      cache_dir=$2
      shift 2
      ;;
    --cache-dir=*)
      cache_dir=${1#--cache-dir=}
      shift
      ;;
    --safety-margin)
      need_value "$1" "${2-}"
      safety_margin=$2
      shift 2
      ;;
    --safety-margin=*)
      safety_margin=${1#--safety-margin=}
      shift
      ;;
    --cache-key)
      need_value "$1" "${2-}"
      cache_key=$2
      shift 2
      ;;
    --cache-key=*)
      cache_key=${1#--cache-key=}
      shift
      ;;
    --arn|--cluster-arn)
      need_value "$1" "${2-}"
      arn=$2
      shift 2
      ;;
    --arn=*|--cluster-arn=*)
      arn=${1#*=}
      shift
      ;;
    --role-arn)
      need_value "$1" "${2-}"
      role_arn=$2
      shift 2
      ;;
    --role-arn=*)
      role_arn=${1#--role-arn=}
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      fatal "unknown option: $1"
      ;;
  esac
done

[ "$cluster" != "" ] || fatal 'missing --cluster'
[ "$region" != "" ] || fatal 'missing --region'
[ "$cache_dir" != "" ] || fatal 'missing --cache-dir'

case "$safety_margin" in
  ''|*[!0-9]*) fatal '--safety-margin must be a non-negative integer' ;;
esac

umask 077
mkdir -p "$cache_dir" || fatal "failed to create cache dir: $cache_dir"
chmod 700 "$cache_dir" || fatal "failed to set cache dir mode: $cache_dir"

key_value=$(cache_key_value)
cache_name=$(cache_file_name "$key_value")
cache_file=$cache_dir/$cache_name

if cached_json=$(read_cache_if_fresh "$cache_file"); then
  record_stats hit 0
  printf '%s\n' "$cached_json"
  exit 0
fi

debug 'cache miss: invoking aws'
aws_err=$cache_file.$$.aws.err
aws_start_ms=$(current_millis)
json=$(call_aws 2>"$aws_err")
aws_status=$?
aws_end_ms=$(current_millis)
actual_aws_ms=$(elapsed_millis "$aws_start_ms" "$aws_end_ms")
if [ "$aws_status" -ne 0 ]; then
  if [ -s "$aws_err" ]; then
    cat "$aws_err" >&2
  fi
  rm -f "$aws_err"
  fatal 'aws eks get-token failed'
fi
if [ -s "$aws_err" ]; then
  debug 'aws wrote stderr on success; suppressing because token fetch succeeded'
fi
rm -f "$aws_err"

expires=$(printf '%s\n' "$json" | expiration_timestamp)
if [ "$expires" != "" ]; then
  if ! timestamp_epoch "$expires" >/dev/null; then
    debug "aws response expirationTimestamp unparseable: $expires"
  fi
else
  debug 'aws response missing expirationTimestamp'
fi

tmp_file=$cache_file.$$.tmp
trap 'rm -f "$tmp_file"' HUP INT TERM EXIT
printf '%s\n' "$json" > "$tmp_file" || fatal 'failed to write temporary cache file'
chmod 600 "$tmp_file" || fatal 'failed to set temporary cache file mode'
mv "$tmp_file" "$cache_file" || fatal 'failed to replace cache file'
trap - HUP INT TERM EXIT

record_stats miss "$actual_aws_ms"
printf '%s\n' "$json"
