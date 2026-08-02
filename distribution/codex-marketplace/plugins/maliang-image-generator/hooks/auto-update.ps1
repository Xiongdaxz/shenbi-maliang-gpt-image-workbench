$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Net.Http

$PluginName = "maliang-image-generator"
$MarketplaceName = "maliang-internal"
$Selector = "$PluginName@$MarketplaceName"
$CheckInterval = [TimeSpan]::FromHours(24)
$LockStale = [TimeSpan]::FromMinutes(10)
$MaximumManifestBytes = 256KB
$MaximumArchiveBytes = 50MB
$MaximumExtractedBytes = 200MB
$MaximumExtractedFiles = 500

function Write-HookContext([string]$Message) {
  [ordered]@{
    systemMessage = $Message
    hookSpecificOutput = [ordered]@{
      hookEventName = "PreToolUse"
      additionalContext = $Message
    }
  } | ConvertTo-Json -Compress -Depth 8 | Write-Output
}

function Write-HookBlock([string]$Reason) {
  [ordered]@{
    systemMessage = $Reason
    hookSpecificOutput = [ordered]@{
      hookEventName = "PreToolUse"
      permissionDecision = "deny"
      permissionDecisionReason = $Reason
    }
  } | ConvertTo-Json -Compress -Depth 8 | Write-Output
}

function ConvertTo-StateTable($Value) {
  $state = [ordered]@{ schemaVersion = 1 }
  if ($null -ne $Value -and $Value.schemaVersion -eq 1) {
    foreach ($property in $Value.PSObject.Properties) {
      $state[$property.Name] = $property.Value
    }
  }
  return $state
}

function Read-JsonFile([string]$LiteralPath) {
  return [IO.File]::ReadAllText($LiteralPath) | ConvertFrom-Json
}

function Write-State([string]$DataDirectory, [System.Collections.IDictionary]$State) {
  $target = Join-Path $DataDirectory "update-state.json"
  $temporary = "$target.$([Guid]::NewGuid().ToString('N')).tmp"
  $json = $State | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($temporary, "$json`n", [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $target -Force
}

function Read-State([string]$DataDirectory) {
  $target = Join-Path $DataDirectory "update-state.json"
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    return [ordered]@{ schemaVersion = 1 }
  }
  return ConvertTo-StateTable (Read-JsonFile $target)
}

function Write-UpdateLog([string]$DataDirectory, [string]$Message) {
  $target = Join-Path $DataDirectory "auto-update.log"
  if ((Test-Path -LiteralPath $target -PathType Leaf) -and (Get-Item -LiteralPath $target).Length -gt 256KB) {
    Move-Item -LiteralPath $target -Destination "$target.previous" -Force
  }
  $safeMessage = ($Message -replace "[`r`n]+", " ")
  if ($safeMessage.Length -gt 1000) { $safeMessage = $safeMessage.Substring(0, 1000) }
  [IO.File]::AppendAllText($target, "$([DateTime]::UtcNow.ToString('o')) $safeMessage`n", [Text.UTF8Encoding]::new($false))
}

function Get-UpdateMode([string]$DataDirectory) {
  $environmentMode = [string]$env:MALIANG_PLUGIN_UPDATE_MODE
  if (-not [string]::IsNullOrWhiteSpace($environmentMode)) {
    $mode = $environmentMode.Trim().ToLowerInvariant()
    if ($mode -notin @("auto", "notify", "off")) {
      throw "MALIANG_PLUGIN_UPDATE_MODE must be auto, notify, or off"
    }
    return $mode
  }
  $settingsPath = Join-Path $DataDirectory "update-settings.json"
  if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
    $settings = Read-JsonFile $settingsPath
    $mode = [string]$settings.mode
    if ($mode -notin @("auto", "notify", "off")) {
      throw "update-settings.json mode must be auto, notify, or off"
    }
    return $mode
  }
  $settings = [ordered]@{ schemaVersion = 1; mode = "auto" } | ConvertTo-Json
  [IO.File]::WriteAllText($settingsPath, "$settings`n", [Text.UTF8Encoding]::new($false))
  return "auto"
}

function Get-SemVer([string]$Value) {
  $pattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
  $match = [regex]::Match($Value, $pattern)
  if (-not $match.Success) { throw "Invalid SemVer: $Value" }
  return [ordered]@{
    major = [int64]$match.Groups[1].Value
    minor = [int64]$match.Groups[2].Value
    patch = [int64]$match.Groups[3].Value
    prerelease = if ($match.Groups[4].Success) { @($match.Groups[4].Value.Split('.')) } else { @() }
  }
}

function Compare-SemVer([string]$Left, [string]$Right) {
  $a = Get-SemVer $Left
  $b = Get-SemVer $Right
  foreach ($key in @("major", "minor", "patch")) {
    if ($a[$key] -gt $b[$key]) { return 1 }
    if ($a[$key] -lt $b[$key]) { return -1 }
  }
  if ($a.prerelease.Count -eq 0 -or $b.prerelease.Count -eq 0) {
    if ($a.prerelease.Count -eq $b.prerelease.Count) { return 0 }
    if ($a.prerelease.Count -eq 0) { return 1 }
    return -1
  }
  $length = [Math]::Max($a.prerelease.Count, $b.prerelease.Count)
  for ($index = 0; $index -lt $length; $index += 1) {
    if ($index -ge $a.prerelease.Count) { return -1 }
    if ($index -ge $b.prerelease.Count) { return 1 }
    $leftPart = [string]$a.prerelease[$index]
    $rightPart = [string]$b.prerelease[$index]
    if ($leftPart -ceq $rightPart) { continue }
    $leftNumeric = $leftPart -match '^\d+$'
    $rightNumeric = $rightPart -match '^\d+$'
    if ($leftNumeric -and $rightNumeric) {
      if ([int64]$leftPart -gt [int64]$rightPart) { return 1 }
      return -1
    }
    if ($leftNumeric -ne $rightNumeric) {
      if ($leftNumeric) { return -1 }
      return 1
    }
    if ([string]::CompareOrdinal($leftPart, $rightPart) -gt 0) { return 1 }
    return -1
  }
  return 0
}

function Get-Origin([Uri]$Uri) {
  return $Uri.GetLeftPart([UriPartial]::Authority)
}

function Test-PrivateOrLoopbackHost([string]$Hostname) {
  $normalized = ($Hostname.Trim().ToLowerInvariant() -replace '^\[|\]$', '')
  if ($normalized -ceq "localhost" -or $normalized.EndsWith(".localhost", [StringComparison]::Ordinal)) {
    return $true
  }
  $address = $null
  if (-not [Net.IPAddress]::TryParse($normalized, [ref]$address)) { return $false }
  if ($address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) {
    if ([Net.IPAddress]::IsLoopback($address)) { return $true }
    $bytes = $address.GetAddressBytes()
    return (($bytes[0] -band 0xFE) -eq 0xFC) -or
      ($bytes[0] -eq 0xFE -and ($bytes[1] -band 0xC0) -eq 0x80)
  }
  if ($address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $bytes = $address.GetAddressBytes()
  return $bytes[0] -eq 10 -or
    $bytes[0] -eq 127 -or
    ($bytes[0] -eq 169 -and $bytes[1] -eq 254) -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or
    ($bytes[0] -eq 100 -and $bytes[1] -ge 64 -and $bytes[1] -le 127)
}

function Assert-AutomaticUpdateUri([Uri]$Uri, [string]$Field) {
  if (-not [string]::IsNullOrEmpty($Uri.UserInfo)) { throw "$Field contains credentials" }
  if ($Uri.Scheme -ceq "https") { return }
  if ($Uri.Scheme -ceq "http" -and (Test-PrivateOrLoopbackHost $Uri.Host)) { return }
  throw "$Field must use HTTPS or trusted local/private-LAN HTTP"
}

function Assert-TrustedUri([string]$Value, [string]$Field, [string]$ExpectedOrigin) {
  $uri = [Uri]$Value
  Assert-AutomaticUpdateUri $uri $Field
  if ((Get-Origin $uri) -cne $ExpectedOrigin) { throw "Untrusted $Field origin" }
  return $uri
}

function Assert-Bool($Value, [string]$Field) {
  if ($Value -isnot [bool]) { throw "Invalid $Field" }
}

function Assert-LatestManifest($Value, [string]$ExpectedOrigin) {
  if ($Value.schemaVersion -ne 1 -or $Value.type -cne "codex-plugin-marketplace") {
    throw "Invalid update manifest schema"
  }
  if ($Value.marketplace -cne $MarketplaceName -or $Value.plugin -cne $PluginName) {
    throw "Update manifest targets a different plugin"
  }
  if ($Value.channel -cne "stable" -or $Value.archiveRoot -cne "codex-marketplace") {
    throw "Update manifest is not the stable Maliang archive"
  }
  [void](Get-SemVer ([string]$Value.version))
  if ($Value.size -isnot [ValueType] -or [int64]$Value.size -lt 1 -or [int64]$Value.size -gt $MaximumArchiveBytes) {
    throw "Invalid update archive size"
  }
  if ([string]$Value.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Invalid update SHA-256" }
  [void](Assert-TrustedUri ([string]$Value.downloadUrl) "downloadUrl" $ExpectedOrigin)
  [void](Assert-TrustedUri ([string]$Value.mcpResource) "mcpResource" $ExpectedOrigin)
  $update = $Value.update
  if (
    $update.protocolVersion -ne 1 -or
    $update.comparison -cne "semver" -or
    $update.installSelector -cne $Selector -or
    $update.strategy -cne "transactional-local-marketplace-replacement" -or
    $update.defaultMode -cne "auto" -or
    $update.automatic -ne $true -or
    $update.requiresUserApproval -ne $false -or
    $update.activation -cne "next-task-or-restart"
  ) { throw "Unsupported update policy" }
  if ($update.compatibility -notin @("compatible", "incompatible")) { throw "Invalid update compatibility" }
  Assert-Bool $update.critical "critical"
  Assert-Bool $update.blockOldVersion "blockOldVersion"
  if ([int]$update.checkIntervalHours -lt 1 -or [int]$update.checkIntervalHours -gt 168) {
    throw "Invalid checkIntervalHours"
  }
}

function Read-PluginManifest([string]$PluginRoot) {
  $manifestPath = Join-Path $PluginRoot ".codex-plugin\plugin.json"
  $manifest = Read-JsonFile $manifestPath
  if ($manifest.name -cne $PluginName) { throw "Installed plugin name mismatch" }
  [void](Get-SemVer ([string]$manifest.version))
  $homepage = [Uri][string]$manifest.homepage
  Assert-AutomaticUpdateUri $homepage "Installed plugin homepage"
  return $manifest
}

function Invoke-CodexJson([string[]]$Arguments, [string]$Label, [string]$DataDirectory) {
  $stderrPath = Join-Path $DataDirectory "codex-$([Guid]::NewGuid().ToString('N')).stderr"
  try {
    $stdout = & codex @Arguments 2>$stderrPath | Out-String
    if ($LASTEXITCODE -ne 0) {
      $stderr = if (Test-Path -LiteralPath $stderrPath) { [IO.File]::ReadAllText($stderrPath) } else { "" }
      throw "$Label failed: $(($stderr + $stdout).Trim().Substring(0, [Math]::Min(500, ($stderr + $stdout).Trim().Length)))"
    }
    return $stdout | ConvertFrom-Json
  } finally {
    Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-InstalledPlugin([string]$DataDirectory) {
  $listing = Invoke-CodexJson @("plugin", "list", "--json") "codex plugin list" $DataDirectory
  $plugin = @($listing.installed) | Where-Object { $_.pluginId -ceq $Selector } | Select-Object -First 1
  if ($null -eq $plugin) { throw "Installed plugin $Selector was not found" }
  if ($plugin.enabled -ne $true) { throw "Installed plugin $Selector is disabled" }
  if ($plugin.marketplaceSource.sourceType -cne "local") { throw "Maliang Marketplace is not a local source" }
  [void](Get-SemVer ([string]$plugin.version))
  $marketplaceRoot = [string]$plugin.marketplaceSource.source
  if ($marketplaceRoot.StartsWith('\\?\UNC\')) {
    $marketplaceRoot = '\\' + $marketplaceRoot.Substring(8)
  } elseif ($marketplaceRoot.StartsWith('\\?\')) {
    $marketplaceRoot = $marketplaceRoot.Substring(4)
  }
  $marketplaceRoot = [IO.Path]::GetFullPath($marketplaceRoot)
  $pluginSource = [IO.Path]::GetFullPath([string]$plugin.source.path)
  $rootWithSeparator = $marketplaceRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (
    $marketplaceRoot -ceq [IO.Path]::GetPathRoot($marketplaceRoot) -or
    -not $pluginSource.StartsWith($rootWithSeparator, [StringComparison]::OrdinalIgnoreCase)
  ) { throw "Unsafe Maliang Marketplace path" }
  return [ordered]@{
    marketplaceRoot = $marketplaceRoot
    pluginSource = $pluginSource
    version = [string]$plugin.version
  }
}

function Assert-NoReparsePoints([string]$Directory) {
  $root = Get-Item -LiteralPath $Directory -Force
  if (-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Marketplace root must be a real directory"
  }
  $fileCount = 0
  $totalBytes = [int64]0
  foreach ($item in Get-ChildItem -LiteralPath $Directory -Force -Recurse) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Archive contains a symbolic link or reparse point: $($item.Name)"
    }
    if (-not $item.PSIsContainer) {
      $fileCount += 1
      $totalBytes += [int64]$item.Length
      if ($fileCount -gt $MaximumExtractedFiles -or $totalBytes -gt $MaximumExtractedBytes) {
        throw "Archive extracted contents exceed safety limits"
      }
    }
  }
}

function Assert-MarketplaceRoot(
  [string]$MarketplaceRoot,
  [string]$ExpectedVersion,
  [string]$ExpectedOrigin,
  [string]$ExpectedMcpResource
) {
  Assert-NoReparsePoints $MarketplaceRoot
  $marketplace = Read-JsonFile (Join-Path $MarketplaceRoot ".agents\plugins\marketplace.json")
  if ($marketplace.name -cne $MarketplaceName) { throw "Archive Marketplace name mismatch" }
  $marketplacePlugins = @($marketplace.plugins)
  if ($marketplacePlugins.Count -ne 1) { throw "Automatic updates require a dedicated Maliang Marketplace" }
  $rootEntries = @(Get-ChildItem -LiteralPath $MarketplaceRoot -Force)
  if (
    $rootEntries.Count -ne 2 -or
    @($rootEntries | Where-Object { -not $_.PSIsContainer -or $_.Name -notin @(".agents", "plugins") }).Count -ne 0
  ) { throw "Automatic updates refuse a shared Marketplace directory" }
  $pluginEntries = @(Get-ChildItem -LiteralPath (Join-Path $MarketplaceRoot "plugins") -Force)
  if (
    $pluginEntries.Count -ne 1 -or
    -not $pluginEntries[0].PSIsContainer -or
    $pluginEntries[0].Name -cne $PluginName
  ) { throw "Automatic updates refuse to replace unrelated Marketplace plugins" }
  $entry = $marketplacePlugins[0]
  if (
    $null -eq $entry -or
    $entry.source.source -cne "local" -or
    $entry.source.path -cne "./plugins/$PluginName"
  ) { throw "Archive Marketplace plugin source is invalid" }
  $pluginRoot = Join-Path $MarketplaceRoot "plugins\$PluginName"
  $manifest = Read-PluginManifest $pluginRoot
  if ($manifest.version -cne $ExpectedVersion) { throw "Archive plugin version mismatch" }
  if ((Get-Origin ([Uri][string]$manifest.homepage)) -cne $ExpectedOrigin) { throw "Archive plugin homepage origin mismatch" }
  if ($manifest.hooks -cne "./hooks/hooks.json") { throw "Archive plugin Hook manifest is missing" }
  $hooks = Read-JsonFile (Join-Path $pluginRoot "hooks\hooks.json")
  if ($null -eq $hooks.hooks.PreToolUse) { throw "Archive PreToolUse Hook is missing" }
  $hookText = $hooks.hooks.PreToolUse | ConvertTo-Json -Compress -Depth 10
  if (
    $hookText -notmatch [regex]::Escape('^mcp__maliang__.*$') -or
    $hookText -notmatch 'auto-update\.cmd' -or
    $hookText -notmatch 'auto-update\.ts' -or
    $hookText -notmatch 'auto-update\.mjs'
  ) {
    throw "Archive automatic update Hook is invalid"
  }
  foreach ($required in @(
    "hooks\auto-update.ps1",
    "hooks\auto-update.cmd",
    "hooks\auto-update.ts",
    "hooks\auto-update.mjs",
    "hooks\windows-update-gate.ts",
    "skills\maliang-connection-help\SKILL.md",
    "skills\maliang-image-generator\SKILL.md",
    "skills\maliang-image-generator\scripts\maliang-helper.mjs",
    "mcp\maliang-local-mcp.mjs"
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot $required) -PathType Leaf)) {
      throw "Archive is missing $required"
    }
  }
  $mcp = Read-JsonFile (Join-Path $pluginRoot ".mcp.json")
  if (
    $mcp.mcpServers.maliang.url -cne $ExpectedMcpResource -or
    $mcp.mcpServers.maliang.oauth_resource -cne $ExpectedMcpResource -or
    $mcp.mcpServers.maliang.default_tools_approval_mode -cne "approve"
  ) { throw "Archive Maliang MCP endpoint mismatch" }
  $localMcp = $mcp.mcpServers.maliang_local
  if (
    $null -eq $localMcp -or
    $localMcp.command -cne "node" -or
    $localMcp.cwd -cne "." -or
    @($localMcp.args)[0] -cne "./mcp/maliang-local-mcp.mjs" -or
    @($localMcp.enabled_tools) -notcontains "upload_local_image" -or
    @($localMcp.enabled_tools) -notcontains "save_image_result" -or
    $localMcp.default_tools_approval_mode -cne "approve" -or
    $localMcp.required -ne $false
  ) { throw "Archive Maliang local image MCP config is invalid" }
  return $pluginRoot
}

function Invoke-LimitedHttpGet(
  [Uri]$Uri,
  [string]$Accept,
  [int64]$MaximumBytes,
  [int]$TimeoutSeconds,
  [string]$OutputPath = ""
) {
  if ($MaximumBytes -lt 0) { throw "HTTP response size limit is invalid" }
  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
  try {
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $Uri)
    [void]$request.Headers.Accept.ParseAdd($Accept)
    try {
      $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    } finally {
      $request.Dispose()
    }
    try {
      if (-not $response.IsSuccessStatusCode) {
        throw "HTTP $([int]$response.StatusCode) from $($Uri.AbsolutePath)"
      }
      $responseUri = $response.RequestMessage.RequestUri
      if ((Get-Origin $responseUri) -cne (Get-Origin $Uri)) { throw "HTTP response origin mismatch" }
      $declaredLength = $response.Content.Headers.ContentLength
      if ($null -ne $declaredLength -and [int64]$declaredLength -gt $MaximumBytes) {
        throw "HTTP response exceeds size limit"
      }
      $source = $null
      $target = $null
      try {
        $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $target = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
          [IO.MemoryStream]::new()
        } else {
          [IO.FileStream]::new($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        }
        $buffer = [byte[]]::new(64KB)
        [int64]$total = 0
        while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $total += $read
          if ($total -gt $MaximumBytes) { throw "HTTP response exceeds size limit" }
          $target.Write($buffer, 0, $read)
        }
        if ($target -is [IO.MemoryStream]) {
          return ,$target.ToArray()
        }
      } finally {
        if ($null -ne $target) { $target.Dispose() }
        if ($null -ne $source) { $source.Dispose() }
      }
    } finally {
      if ($null -ne $response) { $response.Dispose() }
    }
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

function Get-RemoteManifest([Uri]$CheckUri) {
  $bytes = [byte[]](Invoke-LimitedHttpGet $CheckUri "application/json" $MaximumManifestBytes 10)
  $origin = Get-Origin $CheckUri
  $latest = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
  Assert-LatestManifest $latest $origin
  return $latest
}

function Save-RemoteArchive($Latest, [string]$ArchivePath) {
  $downloadUri = [Uri][string]$Latest.downloadUrl
  [void](Invoke-LimitedHttpGet $downloadUri "application/zip" $MaximumArchiveBytes 45 $ArchivePath)
  $archive = Get-Item -LiteralPath $ArchivePath
  if ($archive.Length -ne [int64]$Latest.size -or $archive.Length -gt $MaximumArchiveBytes) {
    throw "Downloaded archive size mismatch"
  }
  $hash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -cne ([string]$Latest.sha256).ToLowerInvariant()) {
    throw "Downloaded archive SHA-256 mismatch"
  }
}

function Refresh-Selector([string]$DataDirectory) {
  [void](Invoke-CodexJson @("plugin", "add", $Selector, "--json") "codex plugin add" $DataDirectory)
}

function Install-Transactionally(
  $Latest,
  [string]$CurrentVersion,
  [string]$DataDirectory,
  [string]$MarketplaceRoot
) {
  $expectedOrigin = Get-Origin ([Uri][string]$Latest.downloadUrl)
  [void](Assert-MarketplaceRoot $MarketplaceRoot $CurrentVersion $expectedOrigin ([string]$Latest.mcpResource))
  $nonce = [Guid]::NewGuid().ToString('N')
  $archivePath = Join-Path $DataDirectory "maliang-update-$($Latest.version)-$nonce.zip"
  $extractionDirectory = Join-Path ([IO.Path]::GetDirectoryName($MarketplaceRoot)) ".maliang-extract-$nonce"
  $backupPath = "$MarketplaceRoot.backup-$CurrentVersion-$nonce"
  $failedPath = "$MarketplaceRoot.failed-$($Latest.version)-$nonce"
  $currentMoved = $false
  $stagedMoved = $false
  try {
    Save-RemoteArchive $Latest $archivePath
    New-Item -ItemType Directory -Path $extractionDirectory -ErrorAction Stop | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractionDirectory -Force
    $entries = @(Get-ChildItem -LiteralPath $extractionDirectory -Force)
    if ($entries.Count -ne 1 -or -not $entries[0].PSIsContainer -or $entries[0].Name -cne [string]$Latest.archiveRoot) {
      throw "Downloaded archive root mismatch"
    }
    $stagedRoot = $entries[0].FullName
    [void](Assert-MarketplaceRoot $stagedRoot ([string]$Latest.version) $expectedOrigin ([string]$Latest.mcpResource))
    Move-Item -LiteralPath $MarketplaceRoot -Destination $backupPath
    $currentMoved = $true
    Move-Item -LiteralPath $stagedRoot -Destination $MarketplaceRoot
    $stagedMoved = $true
    Refresh-Selector $DataDirectory
    $installed = Get-InstalledPlugin $DataDirectory
    if ($installed.version -cne [string]$Latest.version) {
      throw "Codex still reports plugin $($installed.version) after installing $($Latest.version)"
    }
    return $backupPath
  } catch {
    $originalError = $_
    try {
      if ($stagedMoved) { Move-Item -LiteralPath $MarketplaceRoot -Destination $failedPath }
      if ($currentMoved) { Move-Item -LiteralPath $backupPath -Destination $MarketplaceRoot }
      if ($currentMoved) { Refresh-Selector $DataDirectory }
      Remove-Item -LiteralPath $failedPath -Force -Recurse -ErrorAction SilentlyContinue
    } catch {
      throw "Update failed and rollback needs manual recovery. Backup: $backupPath. Cause: $originalError. Rollback: $_"
    }
    throw $originalError
  } finally {
    Remove-Item -LiteralPath $extractionDirectory -Force -Recurse -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-MaliangAutoUpdate {
  $pluginRootValue = [string]$env:PLUGIN_ROOT
  $pluginDataValue = [string]$env:PLUGIN_DATA
  if ([string]::IsNullOrWhiteSpace($pluginRootValue) -or [string]::IsNullOrWhiteSpace($pluginDataValue)) {
    throw "PLUGIN_ROOT and PLUGIN_DATA are required"
  }
  $pluginRoot = [IO.Path]::GetFullPath($pluginRootValue)
  $pluginData = [IO.Path]::GetFullPath($pluginDataValue)
  New-Item -ItemType Directory -Path $pluginData -Force | Out-Null
  $hookInputText = [Console]::In.ReadToEnd()
  $hookInput = if ([string]::IsNullOrWhiteSpace($hookInputText)) { $null } else { $hookInputText | ConvertFrom-Json }
  $lockPath = Join-Path $pluginData "auto-update.lock"
  $lockOwned = $false
  try {
    try {
      New-Item -ItemType Directory -Path $lockPath -ErrorAction Stop | Out-Null
      $lockOwned = $true
    } catch {
      $lock = Get-Item -LiteralPath $lockPath -ErrorAction Stop
      if ([DateTime]::UtcNow - $lock.LastWriteTimeUtc -lt $LockStale) { return }
      Remove-Item -LiteralPath $lockPath -Force -Recurse
      New-Item -ItemType Directory -Path $lockPath -ErrorAction Stop | Out-Null
      $lockOwned = $true
    }

    $mode = Get-UpdateMode $pluginData
    if ($mode -eq "off") { return }
    $state = Read-State $pluginData
    $current = Read-PluginManifest $pluginRoot
    if ($state.blockedReason) {
      if ($state.blockedVersion -and (Compare-SemVer ([string]$current.version) ([string]$state.blockedVersion)) -ge 0) {
        [void]$state.Remove("blockedReason")
        [void]$state.Remove("blockedVersion")
        Write-State $pluginData $state
      } else {
        Write-HookBlock ([string]$state.blockedReason)
        return
      }
    }
    if ($state.lastCheckAt) {
      $lastCheck = [DateTime]::Parse([string]$state.lastCheckAt).ToUniversalTime()
      if ([DateTime]::UtcNow - $lastCheck -ge [TimeSpan]::Zero -and [DateTime]::UtcNow - $lastCheck -lt $CheckInterval) {
        return
      }
    }

    $origin = Get-Origin ([Uri][string]$current.homepage)
    $checkUri = [Uri]::new("$origin/plugin/latest.json")
    try {
      $latest = Get-RemoteManifest $checkUri
      $state.lastCheckAt = [DateTime]::UtcNow.ToString('o')
      $state.lastCheckedVersion = [string]$latest.version
      [void]$state.Remove("lastError")
      [void]$state.Remove("lastErrorAt")
      Write-State $pluginData $state
    } catch {
      $message = $_.Exception.Message
      $state.lastCheckAt = [DateTime]::UtcNow.ToString('o')
      $state.lastErrorAt = $state.lastCheckAt
      $state.lastError = $message.Substring(0, [Math]::Min(1000, $message.Length))
      Write-State $pluginData $state
      Write-UpdateLog $pluginData "check-failed $message"
      Write-HookContext "神笔马良自动更新检查失败，当前工具继续使用 $($current.version)：$message"
      return
    }

    if ((Compare-SemVer ([string]$latest.version) ([string]$current.version)) -le 0) {
      Write-UpdateLog $pluginData "up-to-date $($current.version)"
      return
    }
    if ($latest.update.compatibility -ceq "incompatible") {
      $reason = "神笔马良 $($latest.version) 是不兼容更新，未自动覆盖当前 $($current.version)。"
      Write-UpdateLog $pluginData "incompatible $($current.version) -> $($latest.version)"
      if ($latest.update.critical -eq $true -and $latest.update.blockOldVersion -eq $true) {
        $state.blockedReason = "$reason 此版本已被标记为必须迁移，请先按 /plugin/install.json 完成人工更新。"
        $state.blockedVersion = [string]$latest.version
        Write-State $pluginData $state
        Write-HookBlock ([string]$state.blockedReason)
      } else {
        Write-HookContext "$reason 当前调用继续；请在方便时执行人工更新。"
      }
      return
    }
    if ($mode -eq "notify") {
      Write-UpdateLog $pluginData "available $($current.version) -> $($latest.version)"
      Write-HookContext "神笔马良有可用更新 $($current.version) -> $($latest.version)；当前模式为 notify，未自动安装。"
      return
    }

    $installed = Get-InstalledPlugin $pluginData
    if ((Compare-SemVer ([string]$latest.version) ([string]$installed.version)) -le 0) {
      Write-UpdateLog $pluginData "already-installed $($installed.version); loaded $($current.version)"
      Write-HookContext "神笔马良 $($installed.version) 已安装；当前任务仍加载 $($current.version)，请新建任务或重启 Codex 后生效。"
      return
    }
    if ($installed.version -cne [string]$current.version) {
      throw "Loaded plugin $($current.version) does not match installed plugin $($installed.version)"
    }
    if ($state.pendingBackupPath -and $state.pendingVersion -ceq [string]$current.version) {
      $backupPathForCleanup = [IO.Path]::GetFullPath([string]$state.pendingBackupPath)
      $expectedBackupPrefix = ([string]$installed.marketplaceRoot) + ".backup-"
      if (
        [IO.Path]::GetDirectoryName($backupPathForCleanup) -ne [IO.Path]::GetDirectoryName([string]$installed.marketplaceRoot) -or
        -not $backupPathForCleanup.StartsWith($expectedBackupPrefix, [StringComparison]::OrdinalIgnoreCase)
      ) { throw "Refusing to remove an unsafe Marketplace backup path" }
      Remove-Item -LiteralPath $backupPathForCleanup -Force -Recurse
      [void]$state.Remove("pendingBackupPath")
      [void]$state.Remove("pendingVersion")
      [void]$state.Remove("pendingSessionId")
      Write-State $pluginData $state
      Write-UpdateLog $pluginData "previous backup removed before updating $($current.version)"
    }
    $backupPath = Install-Transactionally $latest ([string]$current.version) $pluginData ([string]$installed.marketplaceRoot)
    $state.pendingBackupPath = $backupPath
    $state.pendingVersion = [string]$latest.version
    $state.pendingSessionId = if ($hookInput.session_id) { [string]$hookInput.session_id } else { $null }
    Write-State $pluginData $state
    Write-UpdateLog $pluginData "installed $($current.version) -> $($latest.version); backup $backupPath"
    Write-HookContext "神笔马良已自动更新 $($current.version) -> $($latest.version)。当前工具调用继续使用已加载版本；新版本将在下个任务或重启 Codex 后生效。OAuth 凭据未被清除。"
  } finally {
    if ($lockOwned) { Remove-Item -LiteralPath $lockPath -Force -Recurse -ErrorAction SilentlyContinue }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  $pluginDataForError = [string]$env:PLUGIN_DATA
  try {
    Invoke-MaliangAutoUpdate
  } catch {
    $message = $_.Exception.Message
    if (-not [string]::IsNullOrWhiteSpace($pluginDataForError)) {
      try {
        New-Item -ItemType Directory -Path $pluginDataForError -Force | Out-Null
        Write-UpdateLog $pluginDataForError "update-failed $message"
        $state = Read-State $pluginDataForError
        $state.lastCheckAt = [DateTime]::UtcNow.ToString('o')
        $state.lastErrorAt = $state.lastCheckAt
        $state.lastError = $message.Substring(0, [Math]::Min(1000, $message.Length))
        Write-State $pluginDataForError $state
      } catch {}
    }
    Write-HookContext "神笔马良自动更新失败，已保留当前版本并继续本次工具调用：$message"
  }
}
