[CmdletBinding()]param()
function main() {
  vite build --base=/twikki --emptyOutDir
  $ver = Get-Content .\package.json | ConvertFrom-Json | Select-Object -ExpandProperty version
  Push-Location ../cawoodm.github.io/twikki/
  try {
    git pull
    if ($LASTEXITCODE -ne 0) {throw "GIT PULL Failed!"}
    Remove-Item -Recurse -Force * -Verbose
    Copy-Item ../../twikki/dist/* -Recurse ./ -Verbose
    git add .
    git commit -a -m "twikki-$ver-$(Get-Date -f yyyyMMddhhmm)"
    git push
  } catch {
    throw $_
  } finally {
    Pop-Location
  }
}
$ErrorActionPreference = "Stop"
main