param(
  [Parameter(Mandatory=$true)][string]$Path,
  [Parameter(Mandatory=$true)][string]$Out
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ZipEntryText($zip, $name) {
  $e = $zip.Entries | Where-Object { $_.FullName -eq $name } | Select-Object -First 1
  if (-not $e) { return $null }
  $stream = $e.Open()
  $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
  $text = $reader.ReadToEnd()
  $reader.Close()
  $stream.Close()
  return $text
}

function Column-Index($ref) {
  $letters = ($ref -replace '[0-9]', '')
  $n = 0
  foreach ($ch in $letters.ToCharArray()) {
    $n = $n * 26 + ([int][char]$ch - 64)
  }
  return $n
}

$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Path).Path)

# --- shared strings ---
$shared = New-Object System.Collections.Generic.List[string]
$ssText = Get-ZipEntryText $zip 'xl/sharedStrings.xml'
if ($ssText) {
  $ssDoc = New-Object System.Xml.XmlDocument
  $ssDoc.LoadXml($ssText)
  foreach ($si in $ssDoc.DocumentElement.ChildNodes) {
    $parts = @()
    foreach ($t in $si.SelectNodes("*[local-name()='t']")) { $parts += $t.InnerText }
    foreach ($t in $si.SelectNodes("*[local-name()='r']/*[local-name()='t']")) { $parts += $t.InnerText }
    $shared.Add(($parts -join ''))
  }
}

# --- sheet list ---
$wbDoc = New-Object System.Xml.XmlDocument
$wbDoc.LoadXml((Get-ZipEntryText $zip 'xl/workbook.xml'))
$relsDoc = New-Object System.Xml.XmlDocument
$relsDoc.LoadXml((Get-ZipEntryText $zip 'xl/_rels/workbook.xml.rels'))

$relMap = @{}
foreach ($rel in $relsDoc.DocumentElement.ChildNodes) {
  $relMap[$rel.Id] = $rel.Target
}

$sheets = New-Object System.Collections.Generic.List[object]
foreach ($sheet in $wbDoc.DocumentElement.SelectNodes("*[local-name()='sheets']/*[local-name()='sheet']")) {
  $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $target = $relMap[$rid]
  if (-not $target) { continue }
  $target = $target -replace '^/xl/', '' -replace '^\.\./', ''
  if ($target -notmatch '^xl/') { $target = 'xl/' + $target }
  $sheets.Add([pscustomobject]@{ Name = $sheet.GetAttribute('name'); Target = $target })
}

$result = [ordered]@{}

foreach ($sheet in $sheets) {
  $sheetText = Get-ZipEntryText $zip $sheet.Target
  if (-not $sheetText) { continue }

  $rows = New-Object System.Collections.Generic.List[object]
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DontExpandEntities = $true
  $settings.IgnoreWhitespace = $true
  $settings.IgnoreComments = $true
  $stringReader = New-Object System.IO.StringReader($sheetText)
  $xr = [System.Xml.XmlReader]::Create($stringReader, $settings)

  $currentRow = $null
  $currentCells = $null
  $lastCol = 0

  while ($xr.Read()) {
    if ($xr.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
    $name = $xr.LocalName

    if ($name -eq 'row') {
      if ($currentRow -ne $null) {
        $rows.Add([pscustomobject]@{ r = [int]$currentRow; cells = $currentCells })
      }
      $rAttr = $xr.GetAttribute('r')
      if ($rAttr) { $currentRow = [int]$rAttr } else { $currentRow = ($rows.Count + 1) }
      $currentCells = [ordered]@{}
      $lastCol = 0
      continue
    }

    if ($name -eq 'c' -and $currentRow -ne $null) {
      $ref = $xr.GetAttribute('r')
      if ($ref) { $col = Column-Index $ref } else { $col = $lastCol + 1 }
      $lastCol = $col
      $type = $xr.GetAttribute('t')

      $value = $null
      $sub = $xr.ReadSubtree()
      $sub.Read()
      while ($sub.Read()) {
        if ($sub.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
        if ($sub.LocalName -eq 'v') {
          $value = $sub.ReadElementContentAsString()
          break
        }
        if ($sub.LocalName -eq 'is') {
          $parts = @()
          $isReader = $sub.ReadSubtree()
          while ($isReader.Read()) {
            if ($isReader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $isReader.LocalName -eq 't') {
              $parts += $isReader.ReadElementContentAsString()
            }
          }
          if ($parts.Count -eq 0) { $value = $sub.ReadElementContentAsString() } else { $value = ($parts -join '') }
          break
        }
      }
      $sub.Close()

      if ($value -ne $null) {
        if ($type -eq 's') {
          $idx = 0
          if ([int]::TryParse($value, [ref]$idx) -and $idx -ge 0 -and $idx -lt $shared.Count) {
            $value = $shared[$idx]
          }
        } elseif ($type -eq 'b') {
          if ($value -eq '1') { $value = 'TRUE' } else { $value = 'FALSE' }
        }
        if ($value -ne $null -and $value -ne '') {
          $letter = ''
          $tmp = $col
          while ($tmp -gt 0) {
            $rem = ($tmp - 1) % 26
            $letter = [string][char](65 + $rem) + $letter
            $tmp = [int][math]::Floor(($tmp - 1) / 26)
          }
          $currentCells[$letter] = $value
        }
      }
    }
  }
  $xr.Close()
  if ($currentRow -ne $null) {
    $rows.Add([pscustomobject]@{ r = [int]$currentRow; cells = $currentCells })
  }

  $result[$sheet.Name] = $rows
}

$zip.Dispose()

$json = $result | ConvertTo-Json -Depth 8 -Compress
$full = [System.IO.Path]::GetFullPath($Out)
$dir = [System.IO.Path]::GetDirectoryName($full)
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllText($full, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("Wrote {0} ({1:N0} bytes), sheets: {2}" -f $Out, $json.Length, ($result.Keys -join ', '))
