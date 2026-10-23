package metrics

import (
	"fmt"
	"strings"
	"sync"
	"time"

	sshx "serverui/server/internal/ssh"
)

const collectScript = `sh -c 'printf "__SUI_STAT__\n"; cat /proc/stat; printf "__SUI_MEM__\n"; cat /proc/meminfo; printf "__SUI_VMSTAT__\n"; cat /proc/vmstat; printf "__SUI_DISK__\n"; df -PB1 / 2>/dev/null || df -P /; printf "__SUI_MOUNTS__\n"; if command -v timeout >/dev/null 2>&1; then timeout 2 df -PB1 -x nfs -x nfs4 -x cifs 2>/dev/null; else df -PB1 / 2>/dev/null; fi; printf "__SUI_DISKSTATS__\n"; cat /proc/diskstats; printf "__SUI_DISKMETA__\n"; for d in /sys/block/*; do name=${d##*/}; case $name in loop*|ram*|sr*|fd*) continue ;; esac; printf "%s\t%s\t%s\t%s\n" "$name" "$(cat $d/queue/rotational 2>/dev/null)" "$(cat $d/device/model 2>/dev/null | tr "\012\015" "  ")" "$(cat $d/size 2>/dev/null)"; done; printf "__SUI_MOUNTINFO__\n"; cat /proc/mounts; printf "__SUI_DISKTEMP__\n"; for h in /sys/class/hwmon/hwmon*; do n=$(cat "$h/name" 2>/dev/null); case "$n" in nvme|drivetemp) printf "%s " "$n"; cat "$h/temp1_input" 2>/dev/null; printf "\n";; esac; done; printf "__SUI_UPTIME__\n"; cat /proc/uptime; printf "__SUI_LOAD__\n"; cat /proc/loadavg; printf "__SUI_HOST__\n"; cat /etc/hostname 2>/dev/null || hostname; printf "__SUI_OS__\n"; cat /etc/os-release 2>/dev/null; printf "__SUI_UNAME__\n"; uname -srm; printf "__SUI_CPUINFO__\n"; cat /proc/cpuinfo; printf "__SUI_FREQ__\n"; echo base $(cat /sys/devices/system/cpu/cpu0/cpufreq/base_frequency 2>/dev/null || cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq 2>/dev/null); echo max $(cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq 2>/dev/null); echo cur $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_cur_freq 2>/dev/null); printf "__SUI_CACHE__\n"; for i in 0 1 2 3; do printf "index%s " "$i"; cat /sys/devices/system/cpu/cpu0/cache/index$i/level 2>/dev/null; printf " "; cat /sys/devices/system/cpu/cpu0/cache/index$i/type 2>/dev/null; printf " "; cat /sys/devices/system/cpu/cpu0/cache/index$i/size 2>/dev/null; printf "\n"; done; printf "__SUI_THERMAL__\n"; for z in /sys/class/thermal/thermal_zone*; do [ -f "$z/temp" ] || continue; printf "%s " "$(cat $z/type 2>/dev/null)"; cat "$z/temp" 2>/dev/null; printf "\n"; done; printf "__SUI_NET__\n"; cat /proc/net/dev; printf "__SUI_TCP__\n"; cat /proc/net/tcp 2>/dev/null; printf "__SUI_TCP6__\n"; cat /proc/net/tcp6 2>/dev/null; printf "__SUI_SS__\n"; if command -v timeout >/dev/null 2>&1; then timeout 2 ss -tunap 2>/dev/null; else ss -tunap 2>/dev/null; fi | head -n 250; printf "__SUI_ROUTE__\n"; ip -4 route show default 2>/dev/null; ip route show default 2>/dev/null | head -n 4; printf "__SUI_ADDR4__\n"; ip -4 -o addr show 2>/dev/null; printf "__SUI_ADDR6__\n"; ip -6 -o addr show scope global 2>/dev/null; printf "__SUI_LINK__\n"; ip -o link show 2>/dev/null; printf "__SUI_DNS__\n"; cat /etc/resolv.conf 2>/dev/null; printf "__SUI_IFTYPE__\n"; for n in /sys/class/net/*; do name=${n##*/}; [ "$name" = lo ] && continue; wireless=0; [ -d "$n/wireless" ] && wireless=1; printf "%s\t%s\t%s\t%s\n" "$name" "$(cat $n/type 2>/dev/null)" "$(cat $n/address 2>/dev/null)" "$wireless"; done; printf "__SUI_PS__\n"; P=$( { ps -eo pid=,ppid=,nlwp=,user:16=,pcpu=,pmem=,rss=,etimes=,stat=,comm= --sort=-pcpu 2>/dev/null || ps -eo pid=,ppid=,nlwp=,user:16=,pcpu=,pmem=,rss=,etimes=,stat=,comm= 2>/dev/null || ps -eo pid=,pcpu=,pmem=,rss=,comm= 2>/dev/null; } | head -n 40); printf "%s\n" "$P"; printf "__SUI_PSCOUNT__\n"; ps -eo user=,stat= --no-headers 2>/dev/null | awk "{total++; if(\$1==\"root\") sys++; else usr++; if(\$2 ~ /^R/) run++} END{print \"total\",total+0; print \"user\",usr+0; print \"system\",sys+0; print \"running\",run+0}"; printf "__SUI_PSMETA__\n"; printf "%s\n" "$P" | awk "{print \$1}" | while read pid; do printf "%s\t%s\t%s\n" "$pid" "$(tr "\0\n" "  " < /proc/$pid/cmdline 2>/dev/null | cut -c1-240)" "$(readlink /proc/$pid/cwd 2>/dev/null)"; done; printf "__SUI_VIRT__\n"; systemd-detect-virt 2>/dev/null || echo none; printf "__SUI_IP__\n"; hostname -I 2>/dev/null | awk "{print \$1}"; ip -4 -o addr show scope global 2>/dev/null | awk "{print \$4}" | head -n1; printf "__SUI_DOCKER__\n"; if command -v timeout >/dev/null 2>&1; then timeout 1 docker version --format "{{.Server.Version}}" 2>/dev/null; else docker version --format "{{.Server.Version}}" 2>/dev/null; fi; printf "__SUI_CONTAINERS__\n"; if command -v timeout >/dev/null 2>&1; then timeout 1 docker ps -q 2>/dev/null | wc -l; else docker ps -q 2>/dev/null | wc -l; fi; printf "__SUI_SERVICES__\n"; systemctl list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null | head -n 80'`

type cacheEntry struct {
	prevCPU    cpuSample
	prevCores  []cpuSample
	prevNet    netSample
	prevDisk   diskSample
	prevAt     time.Time
	history    []HistoryPoint
	cached     Snapshot
	cachedAt   time.Time
	err        error
	refreshing bool
}

type Collector struct {
	pool *sshx.Pool

	mu       sync.Mutex
	byServer map[string]*cacheEntry
}

func NewCollector(pool *sshx.Pool) *Collector {
	return &Collector{
		pool:     pool,
		byServer: map[string]*cacheEntry{},
	}
}

func (c *Collector) entry(id string) *cacheEntry {
	if item, ok := c.byServer[id]; ok {
		return item
	}
	item := &cacheEntry{}
	c.byServer[id] = item
	return item
}

func (c *Collector) Cached(id string) (Snapshot, error, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	item := c.entry(id)
	if item.cachedAt.IsZero() {
		return Snapshot{}, item.err, false
	}
	return cloneSnapshot(item.cached), item.err, true
}

func (c *Collector) Invalidate(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.byServer, id)
}

func (c *Collector) RefreshAsync(id string) {
	if id == "" {
		return
	}
	c.mu.Lock()
	item := c.entry(id)
	if item.refreshing {
		c.mu.Unlock()
		return
	}
	item.refreshing = true
	c.mu.Unlock()

	go func() {
		snap, err := c.collect(id)
		c.mu.Lock()
		item := c.entry(id)
		item.refreshing = false
		if err != nil {
			item.err = err
		} else {
			item.cached = snap
			item.cachedAt = time.Now()
			item.err = nil
		}
		c.mu.Unlock()
	}()
}

func (c *Collector) Snapshot(id string) (Snapshot, error) {
	c.mu.Lock()
	item := c.entry(id)
	if !item.cachedAt.IsZero() && time.Since(item.cachedAt) < 1500*time.Millisecond {
		snap := cloneSnapshot(item.cached)
		c.mu.Unlock()
		return snap, nil
	}
	c.mu.Unlock()
	snap, err := c.collect(id)
	c.mu.Lock()
	item = c.entry(id)
	if err != nil {
		item.err = err
	} else {
		item.cached = cloneSnapshot(snap)
		item.cachedAt = time.Now()
		item.err = nil
	}
	c.mu.Unlock()
	return snap, err
}

func (c *Collector) collect(id string) (Snapshot, error) {
	raw, err := c.pool.Run(id, collectScript)
	if err != nil && !strings.Contains(string(raw), "__SUI_STAT__") {
		return Snapshot{}, err
	}
	sections := SplitSections(string(raw))
	now := time.Now()
	nextCPU := ParseCPUStat(sections["STAT"])
	nextCores := ParseCPUCoreStats(sections["STAT"])
	nextNet := ParseNetDev(sections["NET"])
	nextDisk := ParseDiskStats(sections["DISKSTATS"])

	c.mu.Lock()
	item := c.entry(id)
	elapsed := now.Sub(item.prevAt).Seconds()
	firstCPU := item.prevCPU.total == 0
	cpu, user, system, iowait := CPUBreakdown(item.prevCPU, nextCPU)
	cores := CorePercents(item.prevCores, nextCores)
	rx, tx := NetRate(item.prevNet, nextNet, elapsed)
	diskRead, diskWrite, diskReadIops, diskWriteIops := DiskRate(item.prevDisk, nextDisk, elapsed)
	item.prevCPU = nextCPU
	item.prevCores = nextCores
	item.prevNet = nextNet
	item.prevDisk = nextDisk
	item.prevAt = now
	c.mu.Unlock()

	if firstCPU && nextCPU.total > 0 {
		time.Sleep(180 * time.Millisecond)
		statRaw, statErr := c.pool.Run(id, "cat /proc/stat")
		if statErr == nil {
			statText := string(statRaw)
			second := ParseCPUStat(statText)
			secondCores := ParseCPUCoreStats(statText)
			cpu, user, system, iowait = CPUBreakdown(nextCPU, second)
			cores = CorePercents(nextCores, secondCores)
			c.mu.Lock()
			entry := c.entry(id)
			entry.prevCPU = second
			entry.prevCores = secondCores
			c.mu.Unlock()
		}
	}

	mem := ParseMemoryInfo(sections["MEM"])
	faults, majorFaults := ParseVmstat(sections["VMSTAT"])
	minorFaults := faults - majorFaults
	if minorFaults < 0 {
		minorFaults = 0
	}
	diskUsed, diskTotal, diskPct := ParseDiskBytes(sections["DISK"])
	mounts := EnrichMounts(ParseMounts(sections["MOUNTS"]), sections["MOUNTINFO"])
	meta := ParseDiskMeta(sections["DISKMETA"])
	rootDevice := ""
	rootFS := ""
	rootOpts := ""
	for _, mount := range mounts {
		if mount.MountPoint == "/" {
			rootDevice = mount.Device
			rootFS = mount.FSType
			break
		}
	}
	if info, ok := ParseProcMounts(sections["MOUNTINFO"])["/"]; ok {
		if rootDevice == "" {
			rootDevice = info.Source
		}
		if rootFS == "" {
			rootFS = info.FSType
		}
		rootOpts = info.Opts
	}
	if rootDevice != "" && !strings.HasPrefix(rootDevice, "/") {
		rootDevice = "/dev/" + rootDevice
	}
	parent := ParentBlockDevice(rootDevice)
	diskModel := ""
	diskType := "Disk"
	if entry, ok := meta[parent]; ok {
		diskModel = strings.TrimSpace(entry.Model)
		diskType = DiskKind(parent, entry.Rotational)
		if entry.SizeBytes > diskTotal {
			diskTotal = entry.SizeBytes
			if diskTotal > 0 {
				diskPct = round1((float64(diskUsed) / float64(diskTotal)) * 100)
			}
		}
	} else if parent != "" {
		diskType = DiskKind(parent, "")
	}
	diskFree := diskTotal - diskUsed
	if diskFree < 0 {
		diskFree = 0
	}
	identity := ParseCPUIdentity(sections["CPUINFO"])
	baseMHz, maxMHz, curMHz := ParseCPUFreq(sections["FREQ"])
	if baseMHz == 0 {
		baseMHz = identity.MHz
	}
	if baseMHz == 0 {
		baseMHz = curMHz
	}
	l1, l2, l3 := ParseCacheBytes(sections["CACHE"])
	load1, load5, load15 := ParseLoad(sections["LOAD"])
	kernel, arch := ParseUname(sections["UNAME"])
	virt := stringsOr(ParseHostname(sections["VIRT"]), "none")
	if virt == "none" {
		virt = "None"
	}
	logical := identity.Logical
	if logical == 0 {
		logical = len(cores)
	}

	gateway, routeIface := ParseDefaultRoute(sections["ROUTE"])
	primary := routeIface
	if primary == "" {
		primary = ParsePrimaryIface(sections["NET"])
	}
	ipv4, prefix := ParseIPv4(sections["ADDR4"], primary)
	ipv6 := ParseIPv6(sections["ADDR6"], primary)
	kind, sysMAC := ParseIfaceMeta(sections["IFTYPE"], primary)
	mac := ParseLinkMAC(sections["LINK"], primary)
	if mac == "" {
		mac = sysMAC
	}
	if kind == "" {
		kind = ifaceKind(primary, "1", "0")
	}
	tcpActive, tcpEstab, listenPorts := ParseTCPStats(sections["TCP"] + "\n" + sections["TCP6"])
	netProcs := ParseSSProcesses(sections["SS"], rx, tx)

	procs := EnrichProcessMeta(ParseProcesses(sections["PS"]), sections["PSMETA"])
	procTotal, procUser, procSys, procRun := ParseProcessCounts(sections["PSCOUNT"])
	if procTotal == 0 {
		procTotal = len(procs)
	}

	snap := Snapshot{
		Hostname:             ParseHostname(sections["HOST"]),
		CPUUsage:             cpu,
		CPUUser:              user,
		CPUSystem:            system,
		CPUIowait:            iowait,
		CPUCores:             logical,
		CPUPhysicalCores:     identity.Physical,
		CPUModel:             identity.Model,
		CPUBaseMHz:           baseMHz,
		CPUMaxMHz:            maxMHz,
		CPUTempC:             ParseThermal(sections["THERMAL"]),
		L1CacheBytes:         l1,
		L2CacheBytes:         l2,
		L3CacheBytes:         l3,
		Cores:                cores,
		MemoryUsage:          ParseMemory(sections["MEM"]),
		MemoryUsedBytes:      mem.Used(),
		MemoryTotalBytes:     mem.Total,
		MemoryAvailableBytes: mem.Available,
		MemoryCachedBytes:    mem.Cached,
		MemoryBuffersBytes:   mem.Buffers,
		SwapTotalBytes:       mem.SwapTotal,
		SwapUsedBytes:        mem.SwapUsed(),
		SwapFreeBytes:        mem.SwapFree,
		PageFaults:           faults,
		PageFaultsMinor:      minorFaults,
		PageFaultsMajor:      majorFaults,
		DiskUsage:            diskPct,
		DiskUsedBytes:        diskUsed,
		DiskTotalBytes:       diskTotal,
		DiskFreeBytes:        diskFree,
		DiskReadBps:          diskRead,
		DiskWriteBps:         diskWrite,
		DiskReadIops:         diskReadIops,
		DiskWriteIops:        diskWriteIops,
		DiskDevice:           rootDevice,
		DiskModel:            diskModel,
		DiskType:             diskType,
		DiskFSType:           rootFS,
		DiskMountOptions:     rootOpts,
		DiskTempC:            ParseDiskTemp(sections["DISKTEMP"]),
		DiskMounts:           mounts,
		UptimeSeconds:        ParseUptime(sections["UPTIME"]),
		Load1:                load1,
		Load5:                load5,
		Load15:               load15,
		OSName:               ParseOSRelease(sections["OS"]),
		Kernel:               kernel,
		Arch:                 arch,
		Virtualization:       virt,
		IPAddress:            stringsOr(ipv4, ParseFirstIP(sections["IP"])),
		DockerVersion:        ParseHostname(sections["DOCKER"]),
		ContainerCount:       ParseIntLine(sections["CONTAINERS"]),
		NetRxBps:             rx,
		NetTxBps:             tx,
		NetRxBytes:           int64(nextNet.rx),
		NetTxBytes:           int64(nextNet.tx),
		NetConns:             tcpActive,
		NetEstablished:       tcpEstab,
		NetListenPorts:       listenPorts,
		NetIface:             primary,
		NetIfaceType:         kind,
		NetMAC:               mac,
		NetIPv4:              stringsOr(ipv4, ParseFirstIP(sections["IP"])),
		NetIPv6:              ipv6,
		NetSubnet:            IPv4Mask(prefix),
		NetGateway:           gateway,
		NetDNS:               ParseDNS(sections["DNS"]),
		NetProcesses:         netProcs,
		ProcessCount:         procTotal,
		ProcessUserCount:     procUser,
		ProcessSysCount:      procSys,
		ProcessRunning:       procRun,
		Processes:            procs,
		Services:             nil,
	}
	svcs := EnrichServices(ParseServices(sections["SERVICES"]), procs)
	run, stop, fail, other := ServiceCounts(svcs)
	snap.Services = svcs
	snap.ServiceRunning = run
	snap.ServiceStopped = stop
	snap.ServiceFailed = fail
	snap.ServiceOther = other
	if snap.DiskUsage == 0 && diskTotal > 0 {
		snap.DiskUsage = ParseDisk(sections["DISK"])
	}

	point := HistoryPoint{
		T:                 now.UnixMilli(),
		CPU:               snap.CPUUsage,
		CPUUser:           snap.CPUUser,
		CPUSystem:         snap.CPUSystem,
		CPUIowait:         snap.CPUIowait,
		Memory:            snap.MemoryUsage,
		MemUsedBytes:      snap.MemoryUsedBytes,
		MemCachedBytes:    snap.MemoryCachedBytes,
		MemBuffersBytes:   snap.MemoryBuffersBytes,
		MemAvailableBytes: max64(0, snap.MemoryTotalBytes-snap.MemoryUsedBytes-snap.MemoryCachedBytes-snap.MemoryBuffersBytes),
		Disk:              snap.DiskUsage,
		DiskReadBps:       snap.DiskReadBps,
		DiskWriteBps:      snap.DiskWriteBps,
		NetRx:             snap.NetRxBps,
		NetTx:             snap.NetTxBps,
		SvcRunning:        float64(snap.ServiceRunning),
		SvcStopped:        float64(snap.ServiceStopped),
		SvcFailed:         float64(snap.ServiceFailed),
		SvcOther:          float64(snap.ServiceOther),
		Cores:             coreValues(snap.Cores),
	}

	c.mu.Lock()
	item = c.entry(id)
	item.history = append(item.history, point)
	if len(item.history) > 180 {
		item.history = append([]HistoryPoint(nil), item.history[len(item.history)-180:]...)
	}
	snap.History = cloneHistory(item.history)
	item.cached = snap
	item.cachedAt = now
	item.err = nil
	c.mu.Unlock()
	return snap, nil
}

func stringsOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func cloneHistory(in []HistoryPoint) []HistoryPoint {
	if len(in) == 0 {
		return []HistoryPoint{}
	}
	out := make([]HistoryPoint, len(in))
	copy(out, in)
	for i, point := range out {
		if point.Cores != nil {
			cores := make([]float64, len(point.Cores))
			copy(cores, point.Cores)
			out[i].Cores = cores
		}
	}
	return out
}

func cloneSnapshot(in Snapshot) Snapshot {
	in.History = cloneHistory(in.History)
	if in.Processes != nil {
		procs := make([]Process, len(in.Processes))
		copy(procs, in.Processes)
		in.Processes = procs
	}
	if in.Services != nil {
		svcs := make([]Service, len(in.Services))
		copy(svcs, in.Services)
		in.Services = svcs
	}
	if in.Cores != nil {
		cores := make([]CoreUsage, len(in.Cores))
		copy(cores, in.Cores)
		in.Cores = cores
	}
	if in.DiskMounts != nil {
		mounts := make([]DiskMount, len(in.DiskMounts))
		copy(mounts, in.DiskMounts)
		in.DiskMounts = mounts
	}
	if in.NetProcesses != nil {
		procs := make([]NetProcess, len(in.NetProcesses))
		copy(procs, in.NetProcesses)
		in.NetProcesses = procs
	}
	if in.NetListenPorts != nil {
		ports := make([]int, len(in.NetListenPorts))
		copy(ports, in.NetListenPorts)
		in.NetListenPorts = ports
	}
	return in
}

func coreValues(cores []CoreUsage) []float64 {
	out := make([]float64, len(cores))
	for i, core := range cores {
		out[i] = core.Usage
	}
	return out
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func (c *Collector) KillProcess(id string, pid int) error {
	if pid <= 1 {
		return fmt.Errorf("refusing to signal pid %d", pid)
	}
	_, err := c.pool.Run(id, "kill -TERM "+fmt.Sprintf("%d", pid))
	return err
}

func (c *Collector) InspectProcess(id string, pid int) (ProcessInspect, error) {
	if pid <= 0 {
		return ProcessInspect{}, fmt.Errorf("invalid pid")
	}
	idStr := fmt.Sprintf("%d", pid)
	script := `sh -c 'printf "__SUI_CMD__\n"; tr "\0" " " < /proc/` + idStr + `/cmdline 2>/dev/null; printf "\n__SUI_CWD__\n"; readlink /proc/` + idStr + `/cwd 2>/dev/null; printf "\n__SUI_ENV__\n"; tr "\0" "\n" < /proc/` + idStr + `/environ 2>/dev/null | head -n 40; printf "__SUI_FD__\n"; ls -l /proc/` + idStr + `/fd 2>/dev/null | head -n 50; printf "__SUI_SOCK__\n"; ss -tunap 2>/dev/null | grep -F "pid=` + idStr + `" | head -n 20'`
	raw, err := c.pool.Run(id, script)
	if err != nil {
		return ProcessInspect{}, err
	}
	return ParseProcessInspect(string(raw)), nil
}

func (c *Collector) ControlService(id, name, action string) error {
	unit, err := SanitizeUnit(name)
	if err != nil {
		return err
	}
	switch action {
	case "start", "stop", "restart":
	default:
		return fmt.Errorf("invalid action")
	}
	_, err = c.pool.Run(id, "systemctl "+action+" -- "+unit)
	return err
}
