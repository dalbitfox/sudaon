param([Parameter(Mandatory=$true)][Int64]$WindowHandle)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SudaonWindow {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
$result = [SudaonWindow]::SetWindowPos([IntPtr]$WindowHandle, [IntPtr]1, 0, 0, 0, 0, 0x13)
if (-not $result) { exit 1 }
