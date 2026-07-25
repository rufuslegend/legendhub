#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
seed_file="${repo_root}/mysql/init/dev-seed.sql"
baseline_source="${repo_root}/mysql/dev-baseline.sql"
baseline_target="${repo_root}/mysql/init/zz-dev-baseline.sql"
historical_seed="746b1d2:mysql/copy/backup.sql"

if [[ ! -f "${seed_file}" ]]; then
    seed_temp="$(mktemp "${seed_file}.tmp.XXXXXX")"
    trap 'rm -f "${seed_temp}"' EXIT

    git -C "${repo_root}" show "${historical_seed}" > "${seed_temp}"

    perl -pi -e '
        s/legendwiki/legendhub/g;
        s/webapps/legendhub/g;
        if (/^INSERT INTO `(AuthTokens|BannedIPs|MemberRoleMap|Members|NotificationChanges|NotificationQueue|NotificationSettings|Notifications|Permissions|RolePermissionMap)`/) {
            $_ = q{};
        }
    ' "${seed_temp}"

    mv "${seed_temp}" "${seed_file}"
    trap - EXIT
    echo "Created sanitized development seed: ${seed_file}"
else
    echo "Development seed already exists: ${seed_file}"
fi

cp "${baseline_source}" "${baseline_target}"
echo "Created development schema bridge: ${baseline_target}"
