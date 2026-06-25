[CmdletBinding()]param(
  [switch]$Preview = $false
)
function main() {
  cd $PSScriptRoot
  cd ..

  # Bundle the shell with Vite: the platform statically imports the core modules,
  # so Vite produces dist/index.html + a hashed dist/assets/*.js with everything
  # baked in. The compile plugin (buildStart) regenerates public/packages/*.json
  # and public/modules/core.defaults.json, which Vite copies into dist/ as the
  # fetched data layer (packages + shadow tiddlers).
  npx vite build --base=/twikki --emptyOutDir
  if ($LASTEXITCODE -ne 0) {throw "vite build failed!"}

  # Generate the service worker LAST, over the fully-built dist/, so the precache
  # covers the hashed shell bundle and the data layer.
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