[CmdletBinding()]param()
function main() {
  # We don't need vite since we aren't packaging our code
  # We embed a pre-published copy of boot.js
  #vite build --base=/twikki --emptyOutDir
  cd $PSScriptRoot
  cd ..
  Remove-Item dist/* -Recurse -Force
  Copy-Item public/* dist/ -Recurse
  Copy-Item src/index.html dist/
  Copy-Item src/packages/*.js dist/packages/
  mkdir dist/platform/ | Out-Null
  Copy-Item src/platform/*.js dist/platform/

  $ver = Get-Content .\package.json | ConvertFrom-Json | Select-Object -ExpandProperty version
  Push-Location ../cawoodm.github.io/twikki/
  try {
    git pull
    if ($LASTEXITCODE -ne 0) {throw "GIT PULL Failed!"}
    Remove-Item -Recurse -Force * -Verbose
    Copy-Item ../../twikki/dist/* -Recurse ./ -Verbose
    #Read-Host "Commit & Push?"
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