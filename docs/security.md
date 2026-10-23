# Security: signing in, two-factor authentication and recovery

OpenPlexFrontEnd has its own user accounts, separate from plex.tv. Every account must use
**two-factor authentication (2FA)**: a passkey, an authenticator app, or both.

## Signing in

There are two ways to sign in:

1. **Password + second factor.** Enter your username and password, then confirm with a
   passkey, a 6-digit code from your authenticator app, or a recovery code.
2. **Passkey only.** Choose **Sign in with a passkey**, or pick your passkey from the
   username field's suggestions. A passkey already proves two things (your device plus your
   fingerprint, face or PIN), so no password is needed.

After **10 failed attempts** (wrong passwords or wrong codes, in any mix) the account is locked
for **15 minutes**, even if the next attempt is correct. Signing in successfully resets the
counter.

Sessions last up to 30 days. A session ends early after 14 days without use, when you sign out,
or when you change your password, which signs out every other device.

## Setting up two-factor authentication

The first time you sign in, you are asked to set up at least one of these:

| Method                                                          | How                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Passkey** (recommended)                                       | Choose **Add a passkey** and confirm with Face ID, Touch ID, Windows Hello, your fingerprint or your device PIN.          |
| **Authenticator app** (Google Authenticator, 1Password, Authy…) | Choose **Use an authenticator app**, scan the QR code (or type the setup key), then enter the 6-digit code the app shows. |

Passkeys belong to this site's address (for example `plex.example.com`). If the address ever
changes, passkeys stop working and must be added again; authenticator apps keep working.

### Recovery codes

When you set up your first method you receive **10 recovery codes**, shown **only once**.
Download or copy them and keep them somewhere safe, such as a password manager or a printout.

- Each code works **once**, in place of your passkey or authenticator code.
- **Settings → Security** shows how many unused codes you have left.
- **Generate new recovery codes** replaces the whole set. Every old code stops working.

## Managing your sign-in methods

**Settings → Security** lists your passkeys and authenticator apps. You can:

- **Rename** them (for example "Work laptop" or "Pixel 9").
- **Add** another passkey or authenticator app.
- **Remove** one you no longer use.

Adding or removing a method, or generating new recovery codes, requires you to confirm with
an existing method within the last 5 minutes. Use the **Verify it's you** box at the top of
the page. You cannot remove your last method; add a new one first.

**Settings → Account** lists the devices that are signed in. Use **Revoke** to sign one out, for
example a lost phone.

## Account recovery

### I lost my phone or my passkey device

1. Sign in with your password.
2. On the verification screen choose **Use a recovery code** and enter one of your codes.
3. Go to **Settings → Security**. Remove the lost device and add a new passkey or authenticator
   app.
4. If you used several recovery codes, generate a new set.
5. Under **Settings → Account**, revoke any session from the lost device.

### I have no recovery codes left

Ask an administrator. Under **Admin → Users** they can choose **Reset two-factor** for your
account. This removes all your passkeys, authenticator apps and recovery codes and signs you out
everywhere. The next time you sign in with your password, you set up two-factor authentication
again. Administrators never see your secrets.

### The only administrator is locked out

Someone with shell access to the server can reset an account's two-factor authentication from
the command line:

```sh
docker compose exec app node cli.js reset-mfa <username>
```

To create an additional administrator instead:

```sh
docker compose exec app node cli.js create-admin <username>
```

Both commands are recorded in the audit log. See [operations.md](operations.md) for details.

## What administrators can see

The **Audit log** (Admin → Audit log) records each of these with time, account and IP address:

- sign-ins and failed attempts
- lockouts
- two-factor changes
- password changes
- administrator actions

Passwords are stored only as salted argon2id hashes. Recovery codes are stored only as hashes.
Authenticator secrets and Plex tokens are encrypted with the server's `APP_ENCRYPTION_KEY`.
