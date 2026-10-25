# Optional navigation patch. Never overwrites an entire dashboard page.
$path = Join-Path (Get-Location) 'app\control\page.tsx'
if (!(Test-Path $path)) { Write-Host 'Dashboard page not found. Open /control/x402 directly.'; exit 0 }
$content = Get-Content -Raw -Encoding UTF8 $path
if ($content.Contains('href="/control/x402"')) { Write-Host 'x402 link already present.'; exit 0 }
$markers = @(
    '<Link href="/" className={s.softLink}>CRS Sandbox</Link>',
    '<Link href="/" className="text-sm text-sky-400">'
)
$addition = '<Link href="/control/x402" className={s.softLink}>x402 Payments</Link>'
if ($content.Contains($markers[0])) {
    $backup = "$path.before-x402.bak"
    Copy-Item $path $backup -Force
    $content = $content.Replace($markers[0], $addition + [Environment]::NewLine + '            ' + $markers[0])
    Set-Content -Encoding UTF8 -Path $path -Value $content
    Write-Host "Added x402 Payments link. Backup: $backup"
} else {
    Write-Host 'Dashboard layout differs; no changes were made. Open http://localhost:3000/control/x402 directly.'
}
