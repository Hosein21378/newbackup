# PasarGuard Vault — پنل اختصاصی بکاپ و بازیابی بدون لاگ برای PasarGuard

پنل مدیریت تحت وب و ابزار خط فرمان (`pgbackup`) اختصاصی برای [PasarGuard/panel](https://github.com/PasarGuard/panel) جهت تهیه بکاپ از داده‌های حیاتی پنل **با حذف کامل لاگ‌ها**، بازرسی محتوای آرشیو، آپلود/دانلود و بازیابی مستقیم (Restore) از داخل پنل.

---

## نصب تک‌خطی روی سرور (One-Line Install)

دستور زیر را با دسترسی `root` روی سرور لینوکس (Ubuntu / Debian) اجرا کنید *(نام کاربری و ریپازیتوری خود را جایگزین `OWNER/REPO` نمایید)*:

```bash
PG_VAULT_REPO="https://github.com/OWNER/REPO.git" bash -c "$(curl -sL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh)"
```

پس از اجرا، پنل مدیریت روی پورت `3000` فعال می‌شود و ابزار `pgbackup` به‌صورت خودکار روی سرور نصب می‌گردد.

---

## چه مواردی بکاپ گرفته می‌شوند و چه مواردی حذف می‌شوند؟

| وضعیت | مسیر / بخش در PasarGuard | توضیحات |
| :--- | :--- | :--- |
| ✅ شامل می‌شود | `/opt/pasarguard/.env` | تنظیمات پنل، کلیدها و رشته اتصال دیتابیس |
| ✅ شامل می‌شود | `/opt/pasarguard/docker-compose.yml` | پیکربندی سرویس و کانتینرها |
| ✅ شامل می‌شود | دیتابیس (`SQLite WAL` / `MySQL` / `PostgreSQL` / `TimescaleDB`) | بکاپ ایمن با `sqlite3 .backup`، `mysqldump --single-transaction` و `pg_dump` |
| ✅ شامل می‌شود | `/var/lib/pasarguard/certs/` | گواهی‌های SSL/TLS دامنه‌ها |
| ✅ شامل می‌شود | `/var/lib/pasarguard/templates/` | قالب‌های صفحه اشتراک کاربران |
| ✅ شامل می‌شود | `/var/lib/pasarguard/xray_config.json` | پیکربندی هسته Xray-core |
| ❌ **حذف قطعی** | `/var/lib/pasarguard/logs/` | پوشه لاگ‌ها، `access.log` و `error.log` |
| ❌ **حذف قطعی** | `*.log` و `*.log.*` و `*.tmp` | تمامی فایل‌های لاگ و فایل‌های موقت |
| ❌ **حذف اختیاری** | جداول لاگ ترافیک دیتابیس | نادیده‌گرفتن `node_traffic_logs` و `user_usage_logs` در دامپ |

---

## قابلیت‌های کلیدی

- **پنل مدیریت کامل (RTL فارسی)**:
  - ثبت چندین سرور PasarGuard و دریافت دستور نصب تک‌خطی اختصاصی برای هر سرور
  - گرفتن بکاپ فوری از داخل پنل یا تنظیم زمان‌بندی روزانه
  - بازرسی لیست فایل‌های داخل آرشیو `.tar.gz` و تایید حذف صفر تا صدی لاگ‌ها
  - **بازیابی مستقیم از پنل (Restore)** همراه با تهیه اسنپ‌شات ایمن پیش از بازگردانی (`Pre-Restore Safety Snapshot`) و ری‌استارت خودکار کانتینرها
  - آپلود و پاکسازی لاگ برای فایل‌های بکاپ قدیمی و دانلود مستقیم `.tar.gz`
  - پشتیبانی از ارسال همزمان فایل بکاپ به ربات تلگرام

---

## دستورات خط فرمان روی سرور (`pgbackup`)

```bash
# گرفتن بکاپ فوری بدون لاگ
pgbackup backup

# مشاهده لیست بکاپ‌های محلی
pgbackup list

# بازیابی بکاپ همراه با پیش‌نسخه ایمن و ری‌استارت خودکار PasarGuard
pgbackup restore /var/backups/pasarguard/pg-manual-20261118-120000.tar.gz
```
