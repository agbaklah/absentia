#!/usr/bin/env bash
# Seed the LOCAL Supabase stack with test accounts (never run against production).
# Password for every account: Passw0rd!Local
set -euo pipefail
API="http://127.0.0.1:55321"
KEY="sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz"
PASS="Passw0rd!Local"
SQL="$(dirname "$0")/sql.sh"

create_user() { # email, full_name, team_name
  local team_id
  team_id=$($SQL "select id from teams where name='$3';")
  curl -sS -o /dev/null -w "%{http_code} $1\n" "$API/auth/v1/admin/users" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$PASS\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$2\",\"team_id\":\"$team_id\"}}"
}

# Order matters: the first account bootstraps as admin.
create_user verveit@verve-energyresources.com "Verve IT"       "Engineers"
create_user kwame@verve-energyresources.com   "Kwame Mensah"   "Sales/Tech"
create_user ama@verve-energyresources.com     "Ama Owusu"      "Engineers"
create_user kofi@verve-energyresources.com    "Kofi Boateng"   "Engineers"
create_user esi@verve-energyresources.com     "Esi Darko"      "Logistics"
create_user yaw@verve-energyresources.com     "Yaw Asante"     "Logistics"

$SQL "alter table profiles disable trigger prevent_unauthorized_admin_roles;
update profiles set role='super_admin' where email='verveit@verve-energyresources.com';
update profiles set role='cfo'         where email='kwame@verve-energyresources.com';
update profiles set role='manager'     where email='ama@verve-energyresources.com';
update profiles set role='admin'       where email='esi@verve-energyresources.com';
alter table profiles enable trigger prevent_unauthorized_admin_roles;
update teams t set manager_id = p.id from profiles p where p.email='ama@verve-energyresources.com' and t.name='Engineers';"

$SQL "select email, role, (select name from teams where id=team_id) team from profiles order by created_at;"
