# Jira-first change workflow

This project uses a Jira-first workflow for code changes.

## Rule

Do not use BMad for project changes. Use Jira as the source of change documentation.

## Before changing code

1. Create or identify the Jira ticket.
2. Add the change documentation to Jira:
   - user request or goal
   - affected area
   - intended implementation
   - acceptance notes
   - verification plan
3. Only start editing code after the Jira ticket exists.

## While changing code

Keep the change scoped to the Jira ticket. If the work expands, update Jira before expanding the code change.

## After changing code

1. Run the relevant checks.
2. Update the Jira ticket with:
   - files/areas changed
   - verification performed
   - any remaining notes
3. Commit with the ticket key in the commit message.

Example:

```bash
git commit -m "KAN-123: Fix leave creation"
```

## Helpful commands

Check Jira connection:

```bash
npm run jira:whoami
```

List Jira projects:

```bash
npm run jira:projects
```

Create a Jira ticket:

```bash
npm run jira:create -- --project=KAN --summary="Fix leave creation" --description="Teacher leave creation is failing from the Leave page."
```

Update a Jira ticket after the change:

```bash
npm run jira:comment -- --issue=KAN-123 --body="Changed the leave form validation and verified with npm run typecheck."
```
