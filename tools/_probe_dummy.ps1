$ErrorActionPreference = 'Stop'
$j = (Get-Content 'data\src\monitoring.json' -Raw | ConvertFrom-Json).Data
$h = $j[0].cells.PSObject.Properties
$code = ($h | Where-Object { $_.Value -match 'C.digo de Controle' }).Name
$ctry = ($h | Where-Object { $_.Value -eq 'Country' }).Name
$str  = ($h | Where-Object { $_.Value -match 'Estrutura Organizacional' }).Name
$st   = ($h | Where-Object { $_.Value -match 'Self-Assessment result' }).Name

$br = @($j | Where-Object { $_.r -gt 1 -and $_.cells.$ctry -eq 'Brazil' })
Write-Output ("brazil: " + $br.Count)
$dummy = @($br | Where-Object { ([string]$_.cells.$str) -match 'ORG\.DUMMY' })
Write-Output ("ORG.DUMMY (brazil): " + $dummy.Count)
foreach ($g in ($dummy | Group-Object { [string]$_.cells.$st })) {
  Write-Output ("  {0}: {1}" -f $g.Name, $g.Count)
}
foreach ($d in $dummy) {
  Write-Output ("  {0} | {1} | {2}" -f $d.cells.$code, $d.cells.$str, $d.cells.$st)
}
$allDummy = @($j | Where-Object { $_.r -gt 1 -and ([string]$_.cells.$str) -match 'ORG\.DUMMY' })
Write-Output ("ORG.DUMMY (todas as linhas): " + $allDummy.Count)
