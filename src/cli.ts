/**
 * Administrative command line, for operators with shell access to the server:
 *
 *   node cli.js create-admin <username> [display name]
 *   node cli.js reset-mfa <username>
 *   node cli.js rotate-key --old-key <previous APP_ENCRYPTION_KEY>
 *
 * Uses the same environment variables as the server (DATA_DIR, APP_ENCRYPTION_KEY, ...).
 */
import { CliError, createAdmin, resetMfaCommand, rotateKey } from './lib/server/cli/commands';
import { config } from './lib/server/config';
import { db } from './lib/server/db';

const USAGE = `Usage:
  node cli.js create-admin <username> [display name]
  node cli.js reset-mfa <username>
  node cli.js rotate-key --old-key <previous key>`;

async function main(argv: string[]) {
	const [command, ...args] = argv;
	const out = (line: string) => console.log(line);
	switch (command) {
		case 'create-admin':
			await createAdmin(db(), args[0] ?? '', out, args.slice(1).join(' ') || undefined);
			return;
		case 'reset-mfa':
			resetMfaCommand(db(), args[0] ?? '', out);
			return;
		case 'rotate-key': {
			const index = args.indexOf('--old-key');
			const oldKey = index >= 0 ? args[index + 1] : undefined;
			if (!oldKey) throw new CliError('Usage: rotate-key --old-key <previous key>');
			rotateKey(db(), Buffer.from(oldKey, 'base64'), config().encryptionKey, out);
			return;
		}
		default:
			throw new CliError(USAGE);
	}
}

main(process.argv.slice(2)).then(
	() => process.exit(0),
	(error) => {
		console.error(error instanceof CliError ? error.message : error);
		process.exit(1);
	}
);
