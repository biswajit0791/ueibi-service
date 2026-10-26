export const DEFAULT_MILESTONE_ALERT_SETTINGS = Object.freeze({
  milestoneAlertEnabled: true,
  milestoneAlertDaysBefore: 1,
  milestoneAlertFrequencyDays: 1,
  milestoneAlertOnlyNoProgress: true,
  milestoneAlertSubject: 'Milestone reminder: {{milestoneTitle}} due {{dueDate}}',
  milestoneAlertBody: 'Milestone "{{milestoneTitle}}" on task "{{taskTitle}}" is due {{dueDate}} and is still at {{progress}}% progress.',
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDay(date) {
  const parsed = new Date(date);
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

export function shouldSendMilestoneAlert(milestone, settings, now = new Date()) {
  if (!settings?.milestoneAlertEnabled || milestone.isDone || milestone.status === 'DONE') return false;
  if (settings.milestoneAlertOnlyNoProgress && Number(milestone.progress || 0) > 0) return false;
  if (!settings.milestoneAlertOnlyNoProgress && Number(milestone.progress || 0) >= 100) return false;

  const daysUntilDue = Math.floor((utcDay(milestone.dueDate) - utcDay(now)) / MS_PER_DAY);
  if (daysUntilDue > Number(settings.milestoneAlertDaysBefore ?? 1)) return false;

  if (milestone.lastEscalatedAt) {
    const elapsed = now.getTime() - new Date(milestone.lastEscalatedAt).getTime();
    if (elapsed < Number(settings.milestoneAlertFrequencyDays ?? 1) * MS_PER_DAY) return false;
  }
  return true;
}

export function milestoneAlertContext(milestone, task, now = new Date()) {
  const dueDate = new Date(milestone.dueDate);
  const daysUntilDue = Math.floor((utcDay(dueDate) - utcDay(now)) / MS_PER_DAY);
  return {
    milestoneTitle: milestone.title || '',
    milestoneNumber: String(milestone.order || ''),
    taskTitle: task.title || '',
    dueDate: dueDate.toISOString().slice(0, 10),
    progress: String(Number(milestone.progress || 0)),
    assigneeName: milestone.assignee?.name || task.employee?.name || '',
    taskOwnerName: task.employee?.name || '',
    daysUntilDue: String(Math.max(0, daysUntilDue)),
    daysOverdue: String(Math.max(0, -daysUntilDue)),
  };
}

export function renderMilestoneAlertTemplate(template, context) {
  return String(template || '').replace(/\{\{([a-zA-Z]+)\}\}/g, (token, key) => (
    Object.hasOwn(context, key) ? String(context[key]) : token
  ));
}

export function escapeMilestoneAlertHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}
