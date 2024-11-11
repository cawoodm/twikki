[CmdletBinding()]param(
  $Path,
  $OutDir
)
function main() {
  try {
    Push-Location $PSScriptRoot
    Push-Location "../src/packages"
    Compile-Packages "package" . ../../public/packages
    Pop-Location
    Push-Location "../src/modules"
    Compile-Packages "module" . ../../public/modules
  } catch {
    $Host.UI.WriteErrorLine("ERROR in $($_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)")
    #throw $_
  } finally {
    Pop-Location
  }
}
function Compile-Packages($type, $Path, $OutDir) {
  if (-not (Test-Path $OutDir)) {mkdir $OutDir}
  $repos = 0
  Get-ChildItem -File $OutDir -Filter *.json | Remove-Item
  Get-ChildItem -Directory $Path | ForEach-Object {
    $repo = $_.BaseName
    "Compiling $type '$repo'..."
    # TODO: Read existing $repo.json and compare for real changes (not just created/updated)
    $tiddlers = @()
    Get-ChildItem -File $repo | ForEach-Object {
      $tiddlers += New-TiddlerObject $repo $_
    }
    [psobject]@{
      tiddlers = @($tiddlers)
    } | ConvertTo-Json -Depth 5 > "$OutDir/$repo.json"
    $repos++
  }
  "$repos $($type)s compiled"
}
function New-TiddlerObject($repo, $file) {
  $title = $file.BaseName
  $tags = @()
  # if ($file.name -eq '$CorePackages.tid') {Write-Host 'BreakPoint'}
  if ($repo -eq 'core.defaults') {$tags += "`$Shadow"}
  if ($repo -eq 'base') {$tags += "`$NoEdit"}
  if ($file.Extension -eq '.css') {$tags += "`$StyleSheet"}
  # TODO: Linux provides incorrect CreationTime - we need to cache it and not overwrite
  $tiddler = [PSCustomObject]@{
    title   = $title
    text    = ''
    tags    = $tags
    type    = TypeFromName($file.Name, $file.Extension)
    created = Get-Date (Get-Date $file.CreationTimeUtc) -f o
    updated = Get-Date (Get-Date $file.LastWriteTimeUtc) -f o
  }
  # Parse lines for metadata and text
  $raw = (Get-Content $file -Raw) -replace '\r', ''
  $lines = $raw -split '\n'
  $arrText = @()
  $mode = "meta"
  foreach ($line in $lines) {
    if ($mode -eq "text") {
      $arrText += $line;
      continue
    }
    if ($line -match '^[a-z]+: ') {
      $params = $line -split ':'
      $field = $params[0].trim()
      $value = $params[1].trim()
      if ($value -eq "true") {$value = $true}
      elseif ($value -eq "false") {$value = $false}
      if ($field -eq "tags") {
        $value = @(($value -split ',').trim())
      }
      if ($tiddler."$field" -is [system.array]) {
        $tiddler.tags += $value -split ','
      } elseif ($tiddler."$field") {
        $tiddler."$field" = $value
      } else {
        $tiddler | Add-Member -Name $field -Value $Value -MemberType NoteProperty
      }
    } else {
      # First line not matching 'key: value' is the beginning of the text section
      #  That line is possibly empty in which case we skip it
      if ($line) {$arrText += $line}
      $mode = "text"
    }
  }
  $tiddler.text = $arrText -join "`n"
  return $tiddler
}
function TypeFromName($Name, $Ext) {
  switch ($Name) {
    ".tid" {'x-twikki'}
    ".md" {'markdown'}
    ".js" {'script/js'}
    ".json" {'json'}
    ".css" {'css'}
    ".html" {'html'}
    Default {}
  }
}
$ErrorActionPreference = "Stop"
main