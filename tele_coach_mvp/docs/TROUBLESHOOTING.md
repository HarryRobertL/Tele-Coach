# Tele Coach - Troubleshooting Guide

## Common Issues

### Overlay Not Showing

**Symptoms**: Tele Coach appears to be running but no overlay window is visible.

**Solutions**:
1. **Check System Tray**: Look for Tele Coach icon in your system tray (Windows) or menu bar (macOS)
2. **Restart App**: Right-click the tray icon and select "Restart"
3. **Check Display Settings**: Ensure overlay isn't positioned off-screen
4. **Multiple Monitors**: Try moving the overlay to your primary display

### No Microphone Input

**Symptoms**: Transcription shows no text or "microphone not working" messages.

**Solutions**:
1. **Grant Permissions**:
   - **macOS**: System Settings → Privacy & Security → Microphone → Enable Tele Coach
   - **Windows**: Settings → Privacy → Microphone → Allow Tele Coach
2. **Restart App**: Close and reopen Tele Coach after granting permissions
3. **Check Hardware**: Ensure microphone is connected and not muted
4. **Test with Voice Memos**: Try recording in another app to verify mic works

### Transcription Not Working

**Symptoms**: Microphone is working but no text appears or transcription is inaccurate.

**Solutions**:
1. **Speech Engine Status**: Look for "Speech engine is missing" message
2. **Internet Connection**: Ensure you have an active internet connection
3. **Background Noise**: Move to a quieter environment or use a closer microphone
4. **Speak Clearly**: Talk at a normal pace and enunciate clearly
5. **Restart Coaching**: Stop and start the coaching session

### Whisper Download Failed

**Symptoms**: "Speech engine setup failed" or download progress gets stuck.

**Solutions**:
1. **Check Internet**: Ensure stable internet connection
2. **Firewall**: Temporarily disable firewall or add exception for Tele Coach
3. **Disk Space**: Ensure at least 100MB free space
4. **Retry**: Click "Retry" button in the setup dialog
5. **Manual Install**: Contact support for manual installation steps

### App Blocked by Security

**macOS Gatekeeper**:
- Right-click the app and select "Open"
- Go to System Settings → Privacy & Security → Allow Anyway
- Or download from a trusted source

**Windows Defender**:
- Click "More info" when blocked
- Select "Run anyway"
- Add Tele Coach to exclusions list

### Performance Issues

**Symptoms**: App is slow or laggy during use.

**Solutions**:
1. **Close Other Apps**: Reduce background applications
2. **Restart App**: Clear temporary memory by restarting
3. **Check Resources**: Monitor CPU and memory usage
4. **Update Graphics**: Ensure graphics drivers are current

### Log Files

**Finding Logs**:
- **macOS**: `~/Library/Logs/Tele Coach/`
- **Windows**: `%APPDATA%/Tele Coach/logs/`

**What to Include**:
- Error messages you see
- Steps to reproduce the issue
- Your operating system version
- Approximate time the issue occurs

### Contact Support

When requesting help, please provide:
1. **Operating System**: macOS version or Windows version
2. **Error Message**: Exact text of any error dialogs
3. **Steps**: What you were doing when the issue occurred
4. **Frequency**: How often does this happen?

### Quick Fixes

**Restart Everything**:
1. Close Tele Coach completely
2. Restart your computer
3. Launch Tele Coach again

**Reset Settings**:
1. Go to Tele Coach settings
2. Look for "Reset to defaults" option
3. Try using the app with default settings

### Hardware Compatibility

**Microphones**:
- Built-in laptop microphones work well
- USB headsets provide best quality
- Bluetooth microphones may have latency issues

**Displays**:
- Multiple monitors are supported
- High DPI displays are automatically scaled
- Minimum resolution: 1280x720
