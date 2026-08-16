import express from 'express';

const router = express.Router();

export const CTI_SAMPLES = [
  {
    id: 'sample-1',
    category: 'Execution',
    title: 'PowerShell Download Cradle',
    tactic: 'Execution',
    expectedTid: 'T1059.001',
    instruction: "Process 'cmd.exe' spawned 'powershell.exe -enc JABzAD0A...' and immediately executed a Base64-encoded download cradle to fetch second-stage code.",
    description: 'Adversary leverages PowerShell with encoded commands to evade simple string-matching filters.'
  },
  {
    id: 'sample-2',
    category: 'Persistence',
    title: 'Windows Registry Run Key Persistence',
    tactic: 'Persistence',
    expectedTid: 'T1547.001',
    instruction: "The malware wrote a Run key under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run pointing to payload.exe so it starts automatically at user logon.",
    description: 'Auto-start persistence via the user run registry hive.'
  },
  {
    id: 'sample-3',
    category: 'Defense Evasion',
    title: 'XOR Encrypted Resource Section',
    tactic: 'Defense Evasion',
    expectedTid: 'T1027',
    instruction: "The dropper stored its second-stage payload as XOR-encrypted blobs inside a PE resource section and only decrypted them in dynamic memory at runtime.",
    description: 'Obfuscation using custom encoding to bypass static AV signature detection.'
  },
  {
    id: 'sample-4',
    category: 'Defense Evasion / Privilege Escalation',
    title: 'Remote Process Shellcode Injection',
    tactic: 'Defense Evasion',
    expectedTid: 'T1055',
    instruction: "After gaining a foothold, the implant allocated RWX memory in explorer.exe via VirtualAllocEx and injected shellcode with CreateRemoteThread.",
    description: 'Classic process injection technique targeting explorer.exe.'
  },
  {
    id: 'sample-5',
    category: 'Command and Control',
    title: 'HTTPS Periodic Beaconing',
    tactic: 'Command and Control',
    expectedTid: 'T1071.001',
    instruction: "Beaconing was observed as periodic HTTPS POST requests to cdn-updates.example[.]com/api/v2/checkin with a custom User-Agent and AES payload.",
    description: 'Application layer web protocol abuse for C2 check-in telemetry.'
  },
  {
    id: 'sample-6',
    category: 'Credential Access',
    title: 'LSASS Memory Credential Dumping',
    tactic: 'Credential Access',
    expectedTid: 'T1003.001',
    instruction: "Adversary invoked procdump.exe against lsass.exe to generate a process memory dump file and extract cached plaintext domain passwords.",
    description: 'Dumping Local Security Authority Subsystem Service memory for credentials.'
  },
  {
    id: 'sample-7',
    category: 'Impact',
    title: 'Ransomware Shadow Copy Deletion',
    tactic: 'Impact',
    expectedTid: 'T1486',
    instruction: "The ransomware binary executed 'vssadmin delete shadows /all /quiet' followed by rapid multi-threaded AES-256 encryption of user documents.",
    description: 'Destructive data encryption paired with volume recovery inhibition.'
  },
  {
    id: 'sample-8',
    category: 'Persistence',
    title: 'Scheduled Task Creation',
    tactic: 'Persistence',
    expectedTid: 'T1053.005',
    instruction: "An anomalous scheduled task 'SystemTelemetryUpdate' was created via 'schtasks /create /sc hourly /tr C:\\ProgramData\\updater.exe' to execute every 60 minutes.",
    description: 'Persistence via Windows Task Scheduler.'
  }
];

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    count: CTI_SAMPLES.length,
    samples: CTI_SAMPLES
  });
});

export default router;
