# Run on any Windows box that can reach PRTG. Verifies the API key and lists
# your PRTG groups (send the group list back so the dashboard sections can be mapped).
#
#   .\test-prtg-api.ps1 -PrtgUrl https://asl-opmanager.alasilaccbu.com -ApiToken <key>
param(
  [Parameter(Mandatory)] [string] $PrtgUrl,
  [Parameter(Mandatory)] [string] $ApiToken
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = $PrtgUrl.TrimEnd('/')

$groups = Invoke-RestMethod "$base/api/table.json?content=groups&output=json&count=50000&columns=objid,probe,group,totalsens&apitoken=$ApiToken"
$devs   = Invoke-RestMethod "$base/api/table.json?content=devices&output=json&count=50000&columns=objid,group,device&apitoken=$ApiToken"

"PRTG version : $($groups.'prtg-version')"
"Groups       : $($groups.groups.Count)"
"Devices      : $($devs.devices.Count)"
""
"=== Groups (name / devices) ==="
$devs.devices | Group-Object group | Sort-Object Name |
  ForEach-Object { "{0,-45} {1,4} devices" -f $_.Name, $_.Count }
