[CmdletBinding()]param(
  [switch]$Preview = $false
)
function main() {
  # We don't need vite since we aren't packaging our code
  # We embed a pre-published copy of boot.js
  #vite build --base=/twikki --emptyOutDir
  cd $PSScriptRoot
  cd ..
  
  Remove-Item dist/* -Recurse -Force
  mkdir dist/platform/ | Out-Null

  Copy-Item public/* dist/ -Recurse
  Copy-Item src/index.html dist/
  Copy-Item src/packages/*.js dist/packages/
  Copy-Item src/platform/*.js dist/platform/
  Copy-Item src/modules/*.js dist/modules/

  # Generate the service worker LAST, over the fully-assembled dist/, so the
  # precache covers the complete shell (platform + modules) and data layer.
  npx workbox-cli generateSW workbox-config.cjs
  if ($LASTEXITCODE -ne 0) {throw "workbox generateSW failed!"}

  $ver = Get-Content .\package.json | ConvertFrom-Json | Select-Object -ExpandProperty version
  Push-Location ../cawoodm.github.io/twikki/
  try {
    git pull
    if ($LASTEXITCODE -ne 0) {throw "GIT PULL Failed!"}
    Remove-Item -Recurse -Force *
    Copy-Item ../../twikki/dist/* -Recurse ./
    if ($Preview) {
      # Preview with a STATIC server, not `vite serve` (a dev server that injects
      # @vite/client and transforms assets — which pollutes the SW precache and
      # breaks offline). Serve the parent so the app is reachable at /twikki/,
      # mirroring GitHub Pages. Open http://localhost:8088/twikki/
      npx --yes http-server .. -p 8088 -c-1
      Read-Host "Commit & Push?"
    }
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