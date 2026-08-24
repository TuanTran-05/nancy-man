# Tích hợp Beszel làm telemetry backend cho Ops Console — Design

**Ngày:** 2026-08-24

**Trạng thái:** Chờ người dùng duyệt

**Beszel pin:** `v0.18.8` (`0a9cad31d90b0902302d7a3c538b53c2a548c3cb`)

## 1. Quyết định

Beszel sẽ được dùng như một nguồn telemetry hạ tầng nội bộ cho `man.thienuy.edu.vn`. Beszel Hub và Agent chạy riêng bằng systemd, chỉ giao tiếp qua loopback. `ops-collector` đọc REST API của Hub bằng tài khoản read-only, chuẩn hóa một tập metric đã duyệt, lưu vào Ops SQLite, rồi dùng state machine/Zalo alert hiện tại.

Không thay Ops Console bằng Beszel, không fork mã nguồn Beszel, không cho browser gọi thẳng PocketBase API và không public giao diện Hub trong bản này. Cách này giữ nguyên các probe chuyên biệt của EduTrack, cơ chế TOTP, acknowledge, audit và Zalo, đồng thời bổ sung CPU, memory, swap, load, disk I/O, network và systemd service.

## 2. Mục tiêu và phạm vi

### Trong phạm vi

- Thu thập CPU tổng, CPU breakdown, memory, swap, load average và uptime của VPS.
- Thu thập dung lượng đĩa, disk I/O, network throughput và tổng băng thông.
- Thu trạng thái, CPU, memory và restart count của danh sách systemd service được cho phép.
- Hiển thị metric hiện tại, biểu đồ `1h`, `24h`, `7d`, `30d` và trạng thái stale trên Ops Console.
- Dùng incident/dedupe/recovery/Zalo pipeline hiện tại cho cảnh báo hạ tầng.
- Cài Hub/Agent từ binary release đã pin và xác minh checksum; không bật auto-update.
- Backup dữ liệu Hub và metadata phiên bản theo lịch riêng, không lẫn với database EduTrack.

### Ngoài phạm vi

- Public Beszel Hub qua Nginx, subpath `/infra/`, iframe, SSO, OAuth/OIDC hoặc `TRUSTED_AUTH_HEADER`.
- Thay thế `app_liveness`, `app_health`, `app_process`, `postgres`, `errors`, `cron`, `backup` hay `collector`.
- Beszel native notifications hoặc một kênh cảnh báo thứ hai.
- Docker/Podman container inspection, container log, GPU, SMART, temperature và fan trong lần phát hành đầu.
- Restart service, terminal, SQL, config editor hoặc bất kỳ thao tác thay đổi production nào từ website.
- Phát hiện toàn bộ VPS mất nguồn/mất mạng. Hub cùng host không thể tự cảnh báo khi cả host chết; external dead-man switch là một workstream riêng cần dịch vụ ngoài host.

## 3. Kiến trúc

```text
Browser
  -> Nginx :443
  -> ops-web :3101
  -> Ops SQLite

Beszel Agent (không listener SSH)
  -> outbound WebSocket qua loopback
  -> Beszel Hub 127.0.0.1:8090
  -> PocketBase SQLite trong /srv/beszel/shared/hub/beszel_data

ops-collector
  -> các probe EduTrack/PostgreSQL/log/cron/backup hiện tại
  -> Beszel REST API qua 127.0.0.1:8090 bằng user read-only
  -> adapter + schema validation + field allowlist
  -> Ops SQLite + state machine + Zalo sender hiện tại
```

Browser chỉ nhận projection từ `ops-web`. Token, password, Beszel record nguyên bản, hostname, metadata hệ điều hành và các collection PocketBase khác không được trả ra browser.

Beszel là dependency có thể hỏng, không phải dependency khởi động bắt buộc. Ops Console và toàn bộ monitor cũ vẫn chạy nếu Hub/Agent dừng hoặc API đổi schema.

## 4. Triển khai Beszel

### Phiên bản và artifact

- Chỉ dùng release `v0.18.8`, không dùng `latest`, `main` hay lệnh `update` tự động.
- Repository lưu version manifest, checksum chính thức cho hai binary `linux_amd64`, upstream MIT license và script cài đặt có xác minh SHA-256 trước khi activate.
- Binary được phát hành theo `/srv/beszel/releases/{version}-{checksum-prefix}/` và symlink `/srv/beszel/current`; dữ liệu nằm ngoài release trong `/srv/beszel/shared`.

### Tài khoản hệ điều hành

- `beszel-hub`: chỉ đọc release Hub và ghi `/srv/beszel/shared/hub`.
- `beszel-agent`: chỉ đọc release Agent, file key/token của Agent, `/proc`, `/sys` và system D-Bus cần cho metric/systemd; không đọc Hub database hay Ops secrets.
- Không chạy Hub hoặc Agent bằng root.

### Hub

- Listen cố định `127.0.0.1:8090`.
- Working directory `/srv/beszel/shared/hub` để data nằm tại `beszel_data/`.
- `APP_URL=http://127.0.0.1:8090` trong bản không public.
- `AUTO_LOGIN`, `TRUSTED_AUTH_HEADER`, `USER_EMAIL`, `USER_PASSWORD` không được set.
- `SHARE_ALL_SYSTEMS=false`, `USER_CREATION=false`, `CHECK_UPDATES=false`, `CONTAINER_DETAILS=false`.
- Chỉ operator truy cập trang quản trị qua SSH local port forwarding trong lúc provision/upgrade.

### Agent

- `HUB_URL=http://127.0.0.1:8090`, `DISABLE_SSH=true`; không listen cổng `45876`.
- Dùng `KEY_FILE` và `TOKEN_FILE`, file do `root:beszel-agent` sở hữu, mode `0640`. Token không xuất hiện trong command line hay unit file.
- `DOCKER_HOST=""`, `SKIP_GPU=true`, `SMART_DEVICES=""`.
- `SERVICE_PATTERNS="nginx*,postgresql*,edutrack-ops-*,pm2-*"`; metric của PM2 application vẫn do `app_process` hiện tại phụ trách.
- Agent và Hub dùng systemd hardening tương đương Ops services: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, empty capability bounding set, private temp, address-family allowlist và chỉ các `ReadWritePaths` cần thiết.

### Beszel accounts

- Superuser chỉ dùng bởi operator qua SSH tunnel; credential không được lưu trong Ops env.
- Tạo regular user `ops-telemetry@thienuy.invalid`, role `readonly`, chỉ được share system của VPS này.
- Password ngẫu nhiên ít nhất 32 byte, lưu tại `/etc/edutrack-ops/beszel-password`, owner `root:edutrack-ops`, mode `0640`.
- Auth token PocketBase chỉ tồn tại trong memory của collector, không ghi SQLite/log/audit.

## 5. Beszel adapter trong Ops Console

### Cấu hình

Thêm cấu hình collector sau:

```dotenv
OPS_BESZEL_ENABLED=false
OPS_BESZEL_URL=http://127.0.0.1:8090
OPS_BESZEL_USER=ops-telemetry@thienuy.invalid
OPS_BESZEL_PASSWORD_FILE=/etc/edutrack-ops/beszel-password
OPS_BESZEL_SYSTEM_ID=system-id-created-by-provision-command
OPS_BESZEL_TIMEOUT_MS=5000
```

`OPS_BESZEL_SYSTEM_ID` là giá trị provision-time, không phải giá trị do request cung cấp. Khi `OPS_BESZEL_ENABLED=true`, loader bắt buộc URL phải là `http://127.0.0.1`, timeout nằm trong `1000..10000`, password file là regular file và password không rỗng. Khi flag false, collector không yêu cầu các giá trị còn lại và hành vi cũ không đổi.

### Client và contract

Adapter dùng `fetch` có sẵn của Node 22, không thêm PocketBase SDK. Client chỉ được gọi các endpoint cố định:

- `POST /api/collections/users/auth-with-password`;
- `GET /api/collections/systems/records/{configured-id}`;
- `GET /api/collections/system_stats/records` với filter, sort và fields cố định;
- `GET /api/collections/systemd_services/records` với system ID cố định.

Mọi response được parse bằng Zod schema nội bộ pin theo contract `v0.18.8`. Client cache token; gặp `401` thì xóa token, authenticate lại và retry đúng một lần. Timeout, network error, non-2xx, JSON lỗi hoặc schema lệch được quy về error code hữu hạn; response body và credential không được log.

### Nhịp thu thập

- Collector cycle vẫn chạy mỗi 15 giây.
- Beszel probe chạy mỗi 60 giây và có timeout riêng 5 giây.
- Probe chạy cùng các probe khác và không được chặn việc ghi sample từ nguồn khác.
- Nếu Beszel probe thất bại, collector ghi sample `beszel` lỗi, không ghi lặp lại metric hạ tầng cũ như dữ liệu mới.

## 6. Mô hình dữ liệu

Thêm ba `MonitorName`:

- `beszel`: Hub/API/Agent connectivity, API latency, Hub version, Agent version, system status và thời điểm metric mới nhất.
- `host_resources`: CPU, memory, swap, load, disk và network đã chuẩn hóa.
- `host_services`: tổng service đã match, danh sách service failed và projection an toàn cho từng service.

`host_resources.details` chỉ được chứa:

```text
cpuPercent, cpuUserPercent, cpuSystemPercent, cpuIoWaitPercent,
memoryPercent, memoryUsedBytes, memoryTotalBytes,
swapPercent, swapUsedBytes, swapTotalBytes,
load1, load5, load15, cpuThreads, uptimeSeconds,
diskPercent, diskUsedBytes, diskTotalBytes,
diskReadBytesPerSecond, diskWriteBytesPerSecond, diskIoUtilizationPercent,
networkReceiveBytesPerSecond, networkTransmitBytesPerSecond,
agentVersion, metricObservedAt, probeOk
```

`host_services.details.services` là mảng tối đa 32 phần tử. Mỗi phần tử chỉ có `name`, `state`, `cpuPercent`, `memoryBytes`, `restartCount`, `observedAt`. `name` phải match allowlist `SERVICE_PATTERNS`; description, command, environment, unit path và log không được persist.

Không cần migration bảng mới: sample được lưu trong `monitor_samples`, raw retention 30 ngày và status rollup 12 tháng như hiện tại. Store thêm method đọc history theo monitor/thời gian bằng parameterized SQL. Metric values chỉ có history 30 ngày; daily rollup sau 30 ngày chỉ giữ sample count và level, không giữ giá trị CPU/RAM.

## 7. State machine và cảnh báo

Mọi cảnh báo vẫn dùng hai healthy sample liên tiếp để recovery, incident reconciliation và Zalo cooldown hiện tại.

| Monitor | Warning | Critical |
| --- | --- | --- |
| `beszel` | Không dùng | Hai probe liên tiếp fail, Agent status `down`, hoặc metric age >180 giây |
| CPU | >=85% liên tục 10 phút | >=95% liên tục 10 phút |
| Memory | >=85% liên tục 10 phút | >=95% liên tục 5 phút |
| Root disk | >=80% trong hai sample | >=90% trong hai sample |
| Load | `load5 / cpuThreads >= 1.0` liên tục 10 phút | `load5 / cpuThreads >= 1.5` liên tục 10 phút |
| Systemd | Không dùng | Cùng một matched service failed trong hai sample |

Nếu nhiều điều kiện cùng đúng, critical ưu tiên warning; thứ tự reason cố định là `beszel_unavailable`, `service_failed`, `disk`, `memory`, `cpu`, `load`. Network, swap, disk I/O và restart count chỉ hiển thị trong bản đầu, chưa phát alert để tránh nhiễu.

Tin Zalo không chứa hostname, service description, IP, raw JSON hay metric history. Nó tiếp tục chỉ có severity, tên monitor/reason an toàn, thời điểm, occurrence count và link Ops Console.

## 8. HTTP API và giao diện

### API

`GET /api/overview` tiếp tục trả latest sample của ba monitor mới qua field allowlist.

Thêm endpoint authenticated, `Cache-Control: no-store`:

```text
GET /api/infrastructure/history?range=1h|24h|7d|30d
```

Response chỉ có:

```json
{
  "range": "24h",
  "resolutionSeconds": 300,
  "collectedAt": "2026-08-24T00:00:00.000Z",
  "points": [
    {
      "observedAt": "2026-08-24T00:00:00.000Z",
      "cpuPercent": 0,
      "memoryPercent": 0,
      "diskPercent": 0,
      "load1": 0,
      "networkReceiveBytesPerSecond": 0,
      "networkTransmitBytesPerSecond": 0,
      "diskReadBytesPerSecond": 0,
      "diskWriteBytesPerSecond": 0
    }
  ]
}
```

Range và resolution là mapping cố định: `1h/60s`, `24h/300s`, `7d/1800s`, `30d/7200s`. Backend bucket theo UTC và trả tối đa 720 points. Input không được nối vào SQL; range ngoài enum trả `400`.

### UI

Thêm section **Hạ tầng VPS** ngay sau Overview:

- Bốn card hiện tại: CPU/load, RAM/swap, disk/I/O, network.
- Biểu đồ compact với range `1h`, `24h`, `7d`, `30d`; mặc định `24h`.
- Danh sách service đã match, failed được ưu tiên trên cùng.
- `beszel` down hoặc host sample cũ hơn 150 giây hiển **Telemetry hạ tầng không khả dụng**; không hiển metric cũ như trạng thái hiện tại.
- Metric không có trong response hiển **Không khả dụng**, không thay bằng `0`.
- Không có link sang PocketBase/Beszel Hub, nút restart hay config.

UI dùng SVG/CSS nội bộ cho chart hoặc thư viện đang có; không thêm CDN hay nới CSP. Layout phải dùng được từ 360px và không làm thay đổi luồng login/TOTP.

## 9. Failure handling

- **Hub down/API timeout:** monitor `beszel` đi từ unknown sang critical sau hai lần; monitor cũ vẫn tiếp tục. UI dùng last successful history nhưng đánh dấu stale.
- **Agent down:** system record down hoặc metric age >180 giây tạo `beszel_unavailable`; không suy diễn CPU/RAM cũ là healthy.
- **API schema thay đổi:** Zod reject, error code `beszel_contract_invalid`, không persist raw response. Contract test chặn upgrade trước production.
- **Credential sai/hết hiệu lực:** retry auth một lần, sau đó `beszel_auth_failed`; không loop login trong một cycle.
- **Ops SQLite bận:** hành vi busy timeout/WAL hiện tại được giữ; mỗi phút chỉ thêm ba sample nên không tạo writer burst đáng kể.
- **Beszel database hỏng:** Hub dừng, Ops Console cũ vẫn hoạt động; restore chỉ chạm `/srv/beszel/shared`, không chạm Ops/PostgreSQL.
- **Toàn VPS down:** không có alert từ cùng VPS; dashboard và tài liệu vận hành phải ghi rõ giới hạn này.

## 10. Backup và retention

- Tạo timer backup riêng sau Ops backup. Backup tối thiểu PocketBase `data.db`, Hub `id_ed25519`, version manifest và checksum.
- SQLite backup dùng lệnh `.backup` của `sqlite3` với file tạm do `mktemp` tạo trong thư mục backup, sau đó archive file tạm cùng `id_ed25519` và version manifest; không `cp` trực tiếp file database đang mở.
- Artifact backup được mã hóa bằng cùng age recipient của backup vận hành, có SHA-256 sidecar, owner/mode không cho web user đọc.
- Giữ 7 daily backup và 4 weekly backup; cleanup chỉ match prefix Beszel cố định trong thư mục backup cố định.
- Beszel metric retention upstream là 30 ngày. Ops SQLite cũng giữ normalized raw metric 30 ngày; không cố kéo dài history bằng cách đọc trực tiếp Beszel database.

## 11. Kiểm thử

### Unit và contract

- Config flag false không yêu cầu credential; flag true từ chối non-loopback URL, bad timeout, symlink/non-regular password file và file rỗng.
- Beszel client auth, token cache, `401` retry một lần, timeout, network/non-JSON/non-2xx và redaction error.
- Fixture contract `v0.18.8` cho system, stats và systemd service; missing optional field không thành `0`, unknown field bị bỏ.
- Mapping byte/GB, percentage, CPU breakdown, network/disk rate và timestamp.
- Collector cadence 60 giây, không duplicate metric trong cycle 15 giây, Beszel fail không chặn probe khác.
- Toàn bộ threshold, sustained window, priority, dedupe, reconciliation và two-sample recovery.
- Store history query, UTC buckets, max 720 points, 30-day bound và parameterized input.
- HTTP authentication, `no-store`, invalid range, field allowlist và không leak token/password/raw response.
- UI healthy/stale/unavailable, null metric, range switch, responsive layout và accessibility label cho chart.

### Deployment và integration

- Deployment asset test khẳng định version pin/checksum, Hub bind loopback, Agent `DISABLE_SSH`, không auto-update, secret dùng file và unit hardening.
- Integration test dùng fake PocketBase HTTP server; không cần Internet hay Beszel binary.
- Build, typecheck, Vitest và Playwright Ops Console phải pass trước release.
- Staging smoke với binary thật: Hub health, Agent registration, service projection, 2 phút history, Hub restart và recovery.

## 12. Release và rollback

### Thứ tự release

1. Xác minh official release checksum/attestation và build/test Ops Console.
2. Backup Ops SQLite, Nginx config và release metadata; không restart EduTrack/PM2/PostgreSQL.
3. Cài Hub loopback với feature flag Ops vẫn false; xác minh `/api/health` từ loopback.
4. Qua SSH tunnel, tạo superuser, telemetry user read-only, system và Agent token/key.
5. Cài Agent, xác minh WebSocket registration và không có listener `8090/45876` trên non-loopback.
6. Chạy contract/smoke và thu sample pilot tối thiểu 30 phút; Beszel Hub + Agent RSS tổng <=200 MiB, idle CPU trung bình <=2% và không có regression trên EduTrack latency/health.
7. Phát hành Ops Console adapter/UI, set `OPS_BESZEL_ENABLED=true`, restart chỉ `edutrack-ops-collector` và `edutrack-ops-web`.
8. Xác minh dashboard, history, stale behavior, incident/recovery bằng fixture an toàn và backup Beszel.

### Rollback

1. Set `OPS_BESZEL_ENABLED=false` và restart collector, hoặc restore symlink release Ops trước.
2. Stop/disable `beszel-agent` và `beszel-hub`; không xóa dữ liệu trong rollback khẩn cấp.
3. Xác minh monitor cũ, Ops login/TOTP, Zalo và EduTrack health vẫn xanh.
4. Ba monitor mới chỉ là row trong schema hiện tại, nên không cần database downgrade. Dữ liệu Beszel chỉ bị xóa trong một maintenance task riêng sau khi đã có backup và phê duyệt.

## 13. Tiêu chí hoàn thành

- Không có cổng Beszel mới public; Hub chỉ listen `127.0.0.1:8090`, Agent không listen SSH.
- Browser không thể truy cập PocketBase/Beszel API và không nhận credential/raw record.
- Metric CPU, RAM, disk, load, network và systemd xuất hiện trong hai phút; chart bốn range trả đúng UTC buckets.
- Hai lần Beszel/Agent fail tạo một incident/Zalo; hai healthy sample tạo một recovery, không alert trùng.
- Hub/API fail không làm mất sample của application, PostgreSQL, cron, backup hoặc log monitor.
- Ops Console vẫn read-only; không có restart/config/terminal/SQL.
- Backup Beszel mã hóa, checksum pass và restore rehearsal pass trên thư mục tạm.
- Rollback không restart hay thay đổi EduTrack, PM2, PostgreSQL hoặc Nginx.
