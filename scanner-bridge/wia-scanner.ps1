param(
    [string]$Action = "list",
    [string]$ScannerId = "",
    [int]$Dpi = 300,
    [string]$ColorMode = "COLOR",
    [string]$OutFile = "",
    [string]$Source = "auto"
)

$ErrorActionPreference = "Stop"

# Output JSON friendly errors
trap {
    $err = @{ success = $false; error = $_.Exception.Message }
    $err | ConvertTo-Json -Compress
    exit 0 # Exit 0 so Node can parse the JSON error
}

# Create WIA Device Manager COM Object
$wiaManager = New-Object -ComObject WIA.DeviceManager

if ($Action -eq "list") {
    $scanners = @()
    foreach ($deviceInfo in $wiaManager.DeviceInfos) {
        if ($deviceInfo.Type -eq 1) { # 1 = ScannerDeviceType
            $scanners += @{
                id = $deviceInfo.DeviceID
                name = $deviceInfo.Properties.Item("Name").Value
                protocol = "WIA"
            }
        }
    }
    $scanners | ConvertTo-Json -Compress
    exit 0
}

if ($Action -eq "scan") {
    if ($wiaManager.DeviceInfos.Count -eq 0) {
        throw "No WIA scanners found on the system."
    }
    
    $device = $null

    # Find specific scanner if ID is provided, else use first available
    foreach ($deviceInfo in $wiaManager.DeviceInfos) {
        if ($deviceInfo.Type -eq 1) {
            if ($ScannerId -eq "" -or $deviceInfo.DeviceID -eq $ScannerId) {
                $device = $deviceInfo.Connect()
                break
            }
        }
    }

    if ($null -eq $device) {
        throw "Scanner with ID '$ScannerId' not found or disconnected."
    }
    
    $item = $device.Items.Item(1)
    $warnings = @()
    
    # 6147 = Horizontal DPI, 6148 = Vertical DPI
    try {
        $item.Properties.Item("6147").Value = $Dpi
        $item.Properties.Item("6148").Value = $Dpi
    } catch { 
        $warnings += "DPI $Dpi not explicitly supported by driver. Using fallback."
    }
    
    # 6146 = Current Intent (1: Color, 2: Grayscale, 4: B&W)
    try {
        if ($ColorMode -eq "GRAYSCALE") { $item.Properties.Item("6146").Value = 2 }
        elseif ($ColorMode -eq "MONO") { $item.Properties.Item("6146").Value = 4 }
        else { $item.Properties.Item("6146").Value = 1 }
    } catch { 
        $warnings += "ColorMode '$ColorMode' not supported by driver."
    }

    # Document Handling Select: 3088 (1 = Flatbed, 2 = Feeder (ADF))
    if ($Source -ne "auto") {
        try {
            if ($Source -eq "feeder") {
                $device.Properties.Item("3088").Value = 2
            } elseif ($Source -eq "flatbed") {
                $device.Properties.Item("3088").Value = 1
            }
        } catch { 
            $warnings += "Source '$Source' (ADF/Flatbed) not supported by driver."
        }
    }

    # Execute transfer - Format: JPEG ({B96B3CAE-0728-11D3-9D7B-0000F81EF32E})
    $image = $item.Transfer("{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}")
    
    if (Test-Path $OutFile) {
        Remove-Item $OutFile -Force
    }
    
    $image.SaveFile($OutFile)
    
    $result = @{
        success = $true
        file = $OutFile
        warnings = $warnings
    }
    $result | ConvertTo-Json -Compress
    exit 0
}
