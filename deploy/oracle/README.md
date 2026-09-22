# Deploy LF OrderBook on Oracle Always Free

This guide prepares the existing Node app for a continuously running Ubuntu VM. A free Oracle VM can still be reclaimed if Oracle classifies it as idle; free hosting is not an uptime guarantee.

## 1. Create the VM and DNS

1. In your Oracle Cloud **home region**, create an **Always Free eligible** Ubuntu 24.04 VM. Choose an available AMD Micro or Ampere A1 shape within the Always Free allowance. Attach a public IPv4 address and add your SSH public key.
2. In the VCN's security list or network security group, allow inbound TCP **80** and **443** from `0.0.0.0/0`. Keep **22** restricted to your own IP if possible. Leave **3000** closed: Node listens only on `127.0.0.1`.
3. Create an A record for a domain you control, such as `monitor.example.com`, pointing to the VM's public IP. Wait for the record to resolve. HTTPS certificates require a working domain and reachable ports 80/443.

## 2. Install

SSH into the VM as `ubuntu`, then run:

```bash
git clone https://github.com/jenilvaghamshi04-commits/LF-OrderBook.git
cd LF-OrderBook
sudo bash deploy/oracle/install.sh monitor.example.com
```

Use your real hostname in place of `monitor.example.com`. The installer installs Node.js 22 and Caddy, starts a restricted systemd service, sets up automatic HTTPS, and creates a private `/etc/lf-orderbook.env` with a generated settings admin code.

## 3. Move Telegram monitoring

Check `https://monitor.example.com/` and `https://monitor.example.com/api/market` first. Once those work, **stop or disable the old Render service** before activating Telegram here. The same bot must not be monitored by both servers; an old Render restart could switch its webhook back.

Edit secrets directly on the VM:

```bash
sudoedit /etc/lf-orderbook.env
sudo systemctl restart lf-orderbook
```

Fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the file. Never commit this file, and never paste the bot token into chat. Your previous buy, sell, total, and mute settings are restored from the bot description on restart. The website asks for the generated `SETTINGS_ADMIN_TOKEN` only when you save shared settings. Read that code directly from `/etc/lf-orderbook.env` on your own VM.

Confirm the bot's `/status`, `/depth`, and `/settings` commands work, then use the site's **Send test** control. The old Android APK contains Render's URL; rebuild it with the Oracle domain if you rely on its native background notifications. For iPhone/PWA, open the new HTTPS site and add it to the home screen again.

## 4. Update and inspect

```bash
sudo bash /opt/lf-orderbook/deploy/oracle/update.sh
sudo systemctl status lf-orderbook caddy
sudo journalctl -u lf-orderbook -n 80 --no-pager
```

Updates use a fast-forward pull from GitHub and restart the app. The domain and secrets stay in `/etc`, outside the repository. Check your Oracle usage dashboard to keep resources inside the Always Free allowance.
