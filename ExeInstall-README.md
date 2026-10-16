# Installing & Running Unsigned `.exe` Tools on This PC

## Why `.exe` files fail with `Access is denied`
Corporate Windows Defender / App Control blocks **unsigned `.exe` and `.dll` files** when they run from standard folders such as:
- `C:\Users\<user>\Downloads`
- `C:\Users\<user>\AppData\Local\Temp` (`%TEMP%`)
- `C:\Users\<user>\AppData\Local\Programs` (`%LOCALAPPDATA%`)
- `C:\my-pi`

**Allowed folder:** `C:\GitRepos\` is excluded from this restriction. Any `.exe` or `.dll` placed inside `C:\GitRepos\...` can run.

---

## Case 1: Standalone / Portable `.exe`

If the downloaded `.exe` is a direct program (not an installer that installs into `%LOCALAPPDATA%`):

```powershell
$AppName = "my-tool"
$SourceExe = "$env:USERPROFILE\Downloads\my-tool.exe"
$TargetDir = "C:\GitRepos\tools\$AppName"

# 1. Create folder & temp directory inside C:\GitRepos
New-Item -ItemType Directory -Force -Path "$TargetDir\temp" | Out-Null

# 2. Copy and remove "Mark of the Web" (Zone.Identifier)
Copy-Item -Force $SourceExe "$TargetDir\$AppName.exe"
Unblock-File "$TargetDir\$AppName.exe"

# 3. Redirect TEMP/TMP in case the binary extracts child .exe/.dll files
$env:TEMP = "$TargetDir\temp"
$env:TMP  = "$TargetDir\temp"

# 4. Run it
& "$TargetDir\$AppName.exe"
```

---

## Case 2: Velopack / Squirrel / Electron / NSIS Installers

Many modern desktop apps (e.g. Ghostex, Discord/Slack-style installers) wrap a `.nupkg` or `.zip` payload inside the Setup `.exe` and try to install to `%LOCALAPPDATA%` (which gets blocked).

### Step-by-step extraction into `C:\GitRepos\tools`

```powershell
$AppName = "MyApp"
$InstallerExe = "$env:USERPROFILE\Downloads\MyApp-Setup.exe"
$WorkDir = "C:\GitRepos\tools\$AppName"

New-Item -ItemType Directory -Force -Path "$WorkDir\temp" | Out-Null
Unblock-File $InstallerExe

# 1. Try extracting the installer directly with 7-Zip
& "C:\Program Files\7-Zip\7z.exe" x $InstallerExe "-o$WorkDir\extracted" -y
```

### If the outer `.exe` is a bootstrapper (like Velopack) that drops an inner `*-Setup-*.exe` into `%TEMP%`:

```powershell
# 1. Run the installer briefly with TEMP pointed to C:\GitRepos\tools\<AppName>\temp
$env:TEMP = "$WorkDir\temp"
$env:TMP  = "$WorkDir\temp"
$p = Start-Process -FilePath $InstallerExe -PassThru
Start-Sleep -Seconds 5
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue

# 2. Find the inner setup file dropped in temp and extract it with 7-Zip
$InnerSetup = Get-ChildItem "$WorkDir\temp\*.exe" | Select-Object -First 1 -ExpandProperty FullName
& "C:\Program Files\7-Zip\7z.exe" x $InnerSetup "-o$WorkDir" -y

# 3. Clean up temp
Remove-Item -Recurse -Force "$WorkDir\temp"
```

### Running the extracted app
1. Look inside `C:\GitRepos\tools\<AppName>\lib\app` (or `C:\GitRepos\tools\<AppName>`).
2. Note: For **Velopack** apps, `AppName.exe` is sometimes just a stub that looks in `%LOCALAPPDATA%`. If `AppName.exe` exits without opening a window, run the actual runtime binary in the same folder (for example `*-runtime.exe`).
3. Create a Desktop shortcut if needed:
   ```powershell
   $AppExe = "C:\GitRepos\tools\$AppName\lib\app\MyApp.exe"
   $wsh = New-Object -ComObject WScript.Shell
   $shortcut = $wsh.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\$AppName.lnk")
   $shortcut.TargetPath = $AppExe
   $shortcut.WorkingDirectory = Split-Path $AppExe -Parent
   $shortcut.Save()
   ```

---

## Case 3: Rust (`cargo` / `rustc`)

Rust is already configured globally in `C:\Users\920287\.cargo\config.toml` to place all compiled build outputs into `C:\GitRepos\.cargo-target`:

```toml
[build]
target-dir = "C:/GitRepos/.cargo-target"
```

Because of this, `cargo run` and `cargo test` work from **any** directory on the machine.
