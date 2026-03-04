# Set encoding to UTF8 to support Arabic characters
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = "D:\dental-lab-erp"

if (Test-Path $ProjectRoot) {
    Set-Location $ProjectRoot
    Write-Host "Navigating to project: $ProjectRoot" -ForegroundColor Cyan        

    if (Test-Path ".\deploy.ps1") {
        # Execute the main deploy script
        & ".\deploy.ps1"
    }
    else {
        Write-Error "Could not find deploy.ps1 in the project directory."
    }
}
else {
    Write-Error "Project directory not found: $ProjectRoot"
}

Write-Host "`nPress Enter to exit..." -ForegroundColor Gray
Read-Host
