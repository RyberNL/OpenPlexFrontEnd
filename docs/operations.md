# Operations

Running OpenPlexFrontEnd with Docker Compose: configuration, backups, upgrades, recovery and optional fail2ban. Installation is in the [README](../README.md#install).

All commands run in the directory with `docker-compose.yml` and `.env`.

## Configuration

Settings come from `.env` (see `.env.example`).

| Variable             | Required | Meaning                                                                                                                                                                                                                                          |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUBLIC_ORIGIN`      | yes      | The address people open, e.g. `https://plex.example.com`. Passkeys are bound to its hostname: changing it later means everyone registers their passkeys again.                                                                                   |
| `APP_ENCRYPTION_KEY` | yes      | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts authenticator secrets and Plex tokens in the database.                                                                                                                             |
| `SITE_ADDRESS`       | yes      | The hostname Caddy serves and gets a Let's Encrypt certificate for, e.g. `plex.example.com`.                                                                                                                                                     |
| `PLEX_URL`           | no       | Plex Media Server as seen from the app container (default `http://127.0.0.1:32400`; set your server's LAN address, e.g. `http://192.168.1.10:32400`, unless the app uses the host network on the Plex host). Only the default for the link form. |
| `APP_BIND`           | no       | Your own proxy only: the host address the app listens on (default `127.0.0.1`). See [Using your own reverse proxy](#using-your-own-reverse-proxy).                                                                                               |
| `APP_PORT`           | no       | Your own proxy only: the port the app listens on (default 3000).                                                                                                                                                                                 |
| `XFF_DEPTH`          | no       | How many proxies are in front of the app (default 1). Use 2 if, for example, Cloudflare proxies to your reverse proxy.                                                                                                                           |
| `HTTP_PORT`          | no       | Bundled Caddy only: host port for HTTP (default 80; Let's Encrypt needs 80 reachable from the internet).                                                                                                                                         |
| `HTTPS_PORT`         | no       | Bundled Caddy only: host port for HTTPS and HTTP/3 (default 443).                                                                                                                                                                                |
| `AUTH_RATE_LIMIT`    | no       | Sign-in and MFA attempts allowed per IP address per 5 minutes (default 20). To change it, also add it to the app's `environment` in `docker-compose.yml`.                                                                                        |

The app container also sets these itself: `DATA_DIR=/data` (the database volume), `ORIGIN` (from `PUBLIC_ORIGIN`, so request URLs never come from client headers), and `ADDRESS_HEADER=x-forwarded-for` with `XFF_DEPTH=1` (the client IP as Caddy saw it; Caddy replaces any `X-Forwarded-For` a client sends).

### Using your own reverse proxy

If you already run a reverse proxy with HTTPS (for example the Caddy add-on in Home Assistant), start only the app (`docker compose up -d`, without `--profile caddy`) and add a site to your proxy that forwards to the app's port.

For Caddy:

```caddyfile
plex.example.com {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options nosniff
		Referrer-Policy same-origin
		-Server
	}
	reverse_proxy 127.0.0.1:3000 {
		# Stream responses as they arrive (video playlists and segments, subtitles).
		flush_interval -1
	}
}
```

Points to get right:

- **Where the app listens.** Keep `APP_BIND=127.0.0.1` when the proxy runs on the same host with host networking (as Home Assistant's Caddy add-ons usually do). If the proxy can't reach `127.0.0.1` (it runs elsewhere, or in a container with its own network), set `APP_BIND` to the host's LAN address and use that address in the proxy. Make sure nothing else can reach that port directly: the app takes the client IP (for rate limits and the audit log) from `X-Forwarded-For`, which only your proxy may set.
- **Client IP.** Caddy replaces any `X-Forwarded-For` a client sends; nginx should use `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. With one proxy keep `XFF_DEPTH=1`; with another proxy in front of yours (such as Cloudflare) use 2.
- **Streaming.** Don't buffer responses (`flush_interval -1` in Caddy, `proxy_buffering off;` in nginx), so live TV and subtitles flow immediately.

### Plex sees the app as a remote client

The app container normally reaches Plex through Docker's network, so Plex sees requests from a Docker address (e.g. `172.21.0.2`) and labels them **WAN**: it counts the app's streams as remote. Plex limits remote streaming of your own media without a Plex Pass, so when Plex runs on the same host, run the app on the host network instead. Plex then sees requests from the host itself, which it treats as local. Add this line to `.env`:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.host-network.yml
```

and recreate the app with `docker compose up -d`. The app then listens directly on `APP_BIND:APP_PORT` (keep `APP_BIND=127.0.0.1` for a proxy on the same host). To check, play something and look in Plex's log (`Plex Media Server.log`): requests from the app should show `(Subnet)` or `(LAN)`, not `(WAN)`.

Don't put Docker's networks in **"List of IP addresses and networks that are allowed without auth"** to achieve this: that gives every device on them full access to Plex without signing in. The app doesn't need it; it always sends its own token.

## First run and recovery

While no account exists, the app prints a one-time setup token to its log:

```sh
docker compose logs app | grep "setup token"
```

Opening the site leads to setup, which asks for the token and creates the first administrator. After that, setup is closed.

### Command-line administration

The image includes a CLI for people with shell access to the host. It uses the same environment as the server:

```sh
docker compose exec app node build/cli.js <command>
```

From a source checkout, run `npm run build` first, then `node build/cli.js <command>` with the environment variables set.

| Command                                  | What it does                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-admin <username> [display name]` | Creates an administrator and prints a random temporary password. At first sign-in they must choose a new password and set up two-factor authentication. Use this when every administrator is locked out. |
| `reset-mfa <username>`                   | Removes all of the user's passkeys, authenticator apps and recovery codes and signs them out everywhere. They sign in with their password and set up two-factor authentication again.                    |
| `rotate-key --old-key <previous key>`    | Re-encrypts all stored secrets (authenticator secrets, Plex tokens) with the current `APP_ENCRYPTION_KEY`. See below.                                                                                    |

Every command is recorded in the audit log, marked `via: cli`. Commands exit with status `0` on success and `1` on error, printing the reason.

### Rotating the encryption key

1. Generate a new key: `openssl rand -base64 32`.
2. Stop the app: `docker compose stop app`.
3. Put the new key in `APP_ENCRYPTION_KEY` (in `.env`).
4. Re-encrypt, passing the old key:

   ```sh
   docker compose run --rm --no-deps app node build/cli.js rotate-key --old-key '<old key>'
   ```

   If the old key is wrong, nothing is changed and the command fails.

5. Start the app: `docker compose up -d app`.

Passwords, passkeys and recovery codes are hashes or public keys, so rotation doesn't touch them.

### If the encryption key is lost

The database is still usable, but authenticator secrets and Plex tokens can't be decrypted. Set a new key, then:

1. For each user who used an authenticator app: `reset-mfa <username>`. Users with a passkey can still sign in with it.
2. Link Plex again under **Admin → Plex server**.

## Backups

Everything the app stores is in the `/data` volume (the SQLite database). Back it up together with `.env`: without `APP_ENCRYPTION_KEY`, a backup can't decrypt authenticator secrets and Plex tokens. Keep the key somewhere separate from the backups, such as a password manager.

The database is copied while the app is stopped (a few seconds), so the copy is consistent:

```sh
mkdir -p backups
docker compose stop app
docker compose run --rm --no-deps --user root -v "$PWD/backups:/backups" app \
  sh -c 'cp -a /data "/backups/data-$(date +%F-%H%M)"'
docker compose start app
```

### Restore

```sh
docker compose stop app
docker compose run --rm --no-deps --user root -v "$PWD/backups/data-2026-10-23-1200:/restore:ro" app \
  sh -c 'rm -rf /data/* && cp -a /restore/. /data/ && chown -R node:node /data'
docker compose start app
```

Use the `.env` (encryption key) that belonged to the backup.

## Upgrades

1. Make a backup (above). Database migrations run automatically at start-up and only go forward, so the backup is the way back.
2. Get the new version (e.g. `git pull`).
3. Rebuild and restart:

   ```sh
   docker compose up -d --build   # add --profile caddy if you use the bundled Caddy
   docker compose ps              # app should become "healthy"
   ```

To roll back, check out the previous version, restore the backup taken in step 1, and run `docker compose up -d --build` again.

Caddy renews certificates by itself. To update Caddy, change its image tag in `docker-compose.yml` and run `docker compose up -d`.

## Logs and monitoring

- `docker compose logs -f app`: server log, including the setup token and authentication failures.
- `docker compose ps`: the app has a healthcheck (`/healthz`, which also checks the database).
- **Admin → Audit log** lists sign-ins, failures, MFA changes and admin actions with time, user and IP.

Each failed sign-in, failed two-factor attempt and account lockout is also written to the server log as one line:

```text
AUTH_FAILURE event=auth.login_failed ip=203.0.113.9
```

## fail2ban (optional)

The app already limits attempts per IP and locks accounts after repeated failures. fail2ban can additionally block an address at the firewall. Docker's published ports bypass the host's normal `INPUT` chain, so the ban has to go into Docker's `DOCKER-USER` chain.

`/etc/fail2ban/filter.d/openplexfrontend.conf`:

```ini
[Definition]
# Docker's json-file log wraps each line in JSON: {"log":"AUTH_FAILURE event=... ip=1.2.3.4\n",...}
failregex = AUTH_FAILURE event=\S+ ip=<HOST>\b
ignoreregex =
```

`/etc/fail2ban/jail.d/openplexfrontend.conf`:

```ini
[openplexfrontend]
enabled  = true
filter   = openplexfrontend
logpath  = /var/lib/docker/containers/*/*-json.log
maxretry = 10
findtime = 10m
bantime  = 1h
action   = iptables-allports[name=openplexfrontend, chain=DOCKER-USER]
```

Restart fail2ban (`systemctl restart fail2ban`). Check it with `fail2ban-client status openplexfrontend`, and test the filter with `fail2ban-regex /var/lib/docker/containers/*/*-json.log /etc/fail2ban/filter.d/openplexfrontend.conf`.

The `logpath` glob covers every container's log, but only this app writes `AUTH_FAILURE` lines. Make sure your own address can't be locked out: add it to `ignoreip` in the jail.
