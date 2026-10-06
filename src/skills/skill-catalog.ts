export interface SkillDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly toolNames: readonly string[];
  /** Allowed values per config key. Anything else is rejected, so config can never carry free-form data. */
  readonly configOptions?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Code-defined catalog of skills. A skill is a named group of MoraTools that
 * a user can switch on or off. Every registered tool must belong to exactly
 * one skill (enforced by the coverage test) so that no tool can escape the
 * per-user switch. Adding a new integration means adding its tools here.
 */
export const SKILL_CATALOG: readonly SkillDefinition[] = [
  {
    key: 'memory',
    label: 'Mémoire',
    description: 'Rechercher et enregistrer des souvenirs et des préférences.',
    toolNames: ['search_memories', 'create_memory', 'get_profile_facts'],
  },
  {
    key: 'assistant_core',
    label: 'Actions en attente',
    description: 'Consulter et préparer des actions soumises à confirmation.',
    toolNames: ['list_pending_actions', 'draft_action'],
  },
  {
    key: 'tasks',
    label: 'Tâches',
    description: 'Créer, lister, modifier et terminer des tâches.',
    toolNames: ['create_task', 'list_tasks', 'get_task', 'update_task', 'complete_task'],
  },
  {
    key: 'reminders',
    label: 'Rappels',
    description: 'Créer, lister et annuler des rappels.',
    toolNames: ['create_reminder', 'list_reminders', 'cancel_reminder'],
  },
  {
    key: 'documents',
    label: 'Documents',
    description: 'Rechercher et interroger les documents importés.',
    toolNames: ['search_documents', 'get_document', 'search_document_content', 'query_document_table'],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'Gérer le carnet de contacts.',
    toolNames: ['list_contacts', 'get_contact', 'search_contacts', 'create_contact', 'update_contact'],
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    description: 'Lire, rédiger et envoyer des messages WhatsApp.',
    toolNames: [
      'whatsapp_list_conversations',
      'whatsapp_read_messages',
      'whatsapp_search_messages',
      'whatsapp_get_contact',
      'whatsapp_draft_reply',
      'whatsapp_send_message',
      'whatsapp_send_to_contact',
      'whatsapp_send_document',
    ],
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Lire, rechercher, rédiger et envoyer des emails.',
    toolNames: [
      'email_list_threads',
      'email_read_thread',
      'email_search',
      'email_draft_reply',
      'email_send',
      'email_send_attachment',
    ],
  },
  {
    key: 'calendar',
    label: 'Agenda',
    description: 'Consulter, créer, modifier et annuler des événements.',
    configOptions: { provider: ['mora', 'google'] },
    toolNames: [
      'calendar_list_events',
      'calendar_get_event',
      'calendar_find_free_slots',
      'calendar_create_event',
      'calendar_update_event',
      'calendar_cancel_event',
    ],
  },
  {
    key: 'logistiga',
    label: 'LogistiGA',
    description: 'Rechercher et résumer les données LogistiGA (lecture seule).',
    toolNames: ['logistiga_search', 'logistiga_get_entity', 'logistiga_get_summary'],
  },
  {
    key: 'piston',
    label: 'Piston',
    description: 'Rechercher et résumer les données Piston (lecture seule).',
    toolNames: ['piston_search', 'piston_get_entity', 'piston_get_summary'],
  },
];

const TOOL_TO_SKILL = new Map<string, string>();
for (const skill of SKILL_CATALOG) {
  for (const toolName of skill.toolNames) {
    const existing = TOOL_TO_SKILL.get(toolName);
    if (existing) {
      throw new Error(`Tool "${toolName}" belongs to two skills: "${existing}" and "${skill.key}"`);
    }
    TOOL_TO_SKILL.set(toolName, skill.key);
  }
}

export function skillKeyForTool(toolName: string): string | null {
  return TOOL_TO_SKILL.get(toolName) ?? null;
}

export function findSkillDefinition(key: string): SkillDefinition | null {
  return SKILL_CATALOG.find((skill) => skill.key === key) ?? null;
}
