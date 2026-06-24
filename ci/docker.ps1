[CmdletBinding()]param()
function main() {
  cd $PSScriptRoot
  cd ..

  $ver = Get-Content .\package.json | ConvertFrom-Json | Select-Object -ExpandProperty version

  # Build, tagging both the versioned image and :latest.
  docker build -t "twikki:$ver" -t twikki:latest .
  if ($LASTEXITCODE -ne 0) {throw "docker build failed!"}

  # Replace any existing container (running or stopped). 2>$null swallows the
  # "No such container" error on a first run, where there's nothing to remove.
  docker rm -f twikki 2>$null

  # Run detached with a restart policy so the container survives host reboots and
  # Docker Engine restarts (NOT --rm, which would delete it on stop).
  docker run -d --restart unless-stopped -p 8081:80 --name twikki twikki:latest
  if ($LASTEXITCODE -ne 0) {throw "docker run failed!"}

  Write-Host "twikki running at http://localhost:8081/twikki/"
}
$ErrorActionPreference = "Stop"
main
