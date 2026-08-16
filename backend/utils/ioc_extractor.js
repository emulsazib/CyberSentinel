/**
 * Utility to extract Indicators of Compromise (IOCs) from threat text.
 */
export function extractIOCs(text) {
  if (!text || typeof text !== 'string') return {};

  const cleanText = text.replace(/\[\.\]/g, '.').replace(/hxxp/gi, 'http');

  // IPv4 regex
  const ipRegex = /\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
  const rawIps = text.match(ipRegex) || [];
  const ips = [...new Set(rawIps.filter(ip => ip !== '127.0.0.1' && ip !== '0.0.0.0'))];

  // Domain regex
  const domainRegex = /\b(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|ru|cn|biz|info|cc|xyz|top|example|live|online)\b/gi;
  const domains = [...new Set(cleanText.match(domainRegex) || [])];

  // Hashes (SHA256, SHA1, MD5)
  const sha256Regex = /\b[a-fA-F0-9]{64}\b/g;
  const sha1Regex = /\b[a-fA-F0-9]{40}\b/g;
  const md5Regex = /\b[a-fA-F0-9]{32}\b/g;

  const sha256 = [...new Set(text.match(sha256Regex) || [])];
  const sha1 = [...new Set(text.match(sha1Regex) || [])];
  const md5 = [...new Set(text.match(md5Regex) || [])];

  // Registry Paths
  const regRegex = /\b(?:HKCU|HKLM|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)\\[a-zA-Z0-9_\\\s-]+\b/gi;
  const registryKeys = [...new Set(text.match(regRegex) || [])];

  // Executables / Binaries / Scripts mentioned
  const fileRegex = /\b[a-zA-Z0-9_\-.]+\.(?:exe|dll|ps1|vbs|bat|cmd|sh|elf|bin|iso|lnk|sys)\b/gi;
  const files = [...new Set(text.match(fileRegex) || [])];

  // Suspicious APIs / Tools
  const apiKeywords = [
    'VirtualAllocEx', 'CreateRemoteThread', 'WriteProcessMemory', 'NtUnmapViewOfSection',
    'OpenProcess', 'MiniDumpWriteDump', 'SetWindowsHookEx', 'vssadmin', 'schtasks',
    'powershell.exe', 'cmd.exe', 'procdump.exe', 'mimikatz', 'psexec'
  ];
  const detectedApis = apiKeywords.filter(keyword =>
    text.toLowerCase().includes(keyword.toLowerCase())
  );

  return {
    ips,
    domains,
    hashes: { sha256, sha1, md5 },
    registryKeys,
    files,
    apis: detectedApis,
    totalCount: ips.length + domains.length + sha256.length + sha1.length + md5.length + registryKeys.length + files.length + detectedApis.length
  };
}
