param(
  [Parameter(Mandatory)][string]$Out,
  [string[]]$Keys = @(),      # virtual-key codes in hex, e.g. 0x0D (Enter); "wait:500" sleeps ms; "hold:0x27:800" holds
  [int]$DelayMs = 300
)
# Capture the client area of the running xa.exe window, optionally after sending keys to it.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class XW {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
  public struct RECT { public int L,T,R,B; } public struct POINT { public int X,Y; }
}
"@ -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Drawing
$p = Get-Process xa -ErrorAction Stop | Select-Object -First 1
$h = $p.MainWindowHandle
[XW]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 250
function Send-Key([byte]$vk, [int]$holdMs) {
  if ([XW]::GetForegroundWindow() -ne $h) { throw "game window is not in the foreground; refusing to send input" }
  $scan = [byte][XW]::MapVirtualKey($vk, 0)
  $ext = if ($vk -in 0x25,0x26,0x27,0x28) { 1 } else { 0 }
  [XW]::keybd_event($vk, $scan, $ext, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds $holdMs
  [XW]::keybd_event($vk, $scan, (2 -bor $ext), [UIntPtr]::Zero)
}
foreach ($k in $Keys) {
  if ($k -like 'wait:*') { Start-Sleep -Milliseconds ([int]$k.Substring(5)); continue }
  if ($k -like 'hold:*') { $a = $k.Split(':'); Send-Key ([Convert]::ToByte($a[1], 16)) ([int]$a[2]); continue }
  Send-Key ([Convert]::ToByte($k, 16)) 60
  Start-Sleep -Milliseconds $DelayMs
}
$r = New-Object XW+RECT; [XW]::GetClientRect($h, [ref]$r) | Out-Null
$pt = New-Object XW+POINT; [XW]::ClientToScreen($h, [ref]$pt) | Out-Null
$bmp = New-Object System.Drawing.Bitmap $r.R, $r.B
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($pt.X, $pt.Y, 0, 0, $bmp.Size)
$bmp.Save($Out); $g.Dispose(); $bmp.Dispose()
"saved $Out ($($r.R)x$($r.B))"
