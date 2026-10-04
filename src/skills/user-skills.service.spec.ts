import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserSkillsService } from './user-skills.service.js';
import { SKILL_CATALOG, skillKeyForTool } from './skill-catalog.js';

function buildService(rows: Array<{ skillKey: string; enabled: boolean }> = []) {
  const prisma = {
    userSkill: {
      findMany: vi.fn(async (args?: { where?: { enabled?: boolean } }) =>
        args?.where?.enabled === false ? rows.filter((r) => !r.enabled) : rows,
      ),
      findUnique: vi.fn(async (args: { where: { userId_skillKey: { skillKey: string } } }) => {
        const row = rows.find((r) => r.skillKey === args.where.userId_skillKey.skillKey);
        return row ? { enabled: row.enabled } : null;
      }),
      upsert: vi.fn(async (args: { create: { skillKey: string; enabled: boolean } }) => ({
        skillKey: args.create.skillKey,
        enabled: args.create.enabled,
      })),
    },
  };
  return { service: new UserSkillsService(prisma as never), prisma };
}

describe('skill catalog', () => {
  it('maps every tool to exactly one skill and resolves it back', () => {
    for (const skill of SKILL_CATALOG) {
      for (const toolName of skill.toolNames) {
        expect(skillKeyForTool(toolName)).toBe(skill.key);
      }
    }
  });

  it('returns null for a tool that belongs to no skill', () => {
    expect(skillKeyForTool('not_a_real_tool')).toBeNull();
  });

  it('has unique skill keys', () => {
    const keys = SKILL_CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('UserSkillsService', () => {
  it('lists every catalog skill as enabled when the user has no stored rows (no backfill needed)', async () => {
    const { service } = buildService();
    const skills = await service.listForUser('u1');
    expect(skills).toHaveLength(SKILL_CATALOG.length);
    expect(skills.every((s) => s.enabled)).toBe(true);
  });

  it('reflects a stored disabled row in the listing', async () => {
    const { service } = buildService([{ skillKey: 'whatsapp', enabled: false }]);
    const skills = await service.listForUser('u1');
    expect(skills.find((s) => s.key === 'whatsapp')?.enabled).toBe(false);
    expect(skills.find((s) => s.key === 'tasks')?.enabled).toBe(true);
  });

  it('upserts the state for a known skill', async () => {
    const { service, prisma } = buildService();
    const view = await service.setEnabled('u1', 'email', false);
    expect(view.enabled).toBe(false);
    expect(prisma.userSkill.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_skillKey: { userId: 'u1', skillKey: 'email' } },
        create: { userId: 'u1', skillKey: 'email', enabled: false },
        update: { enabled: false },
      }),
    );
  });

  it('refuses to toggle an unknown skill key', async () => {
    const { service, prisma } = buildService();
    await expect(service.setEnabled('u1', 'spotify', true)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.userSkill.upsert).not.toHaveBeenCalled();
  });

  it('returns every tool of a disabled skill as excluded, and nothing else', async () => {
    const { service } = buildService([{ skillKey: 'whatsapp', enabled: false }]);
    const disabled = await service.disabledToolNames('u1');
    expect(disabled.has('whatsapp_send_message')).toBe(true);
    expect(disabled.has('create_task')).toBe(false);
  });

  it('isToolEnabled is true by default, false only when its skill is disabled', async () => {
    const { service } = buildService([{ skillKey: 'calendar', enabled: false }]);
    expect(await service.isToolEnabled('u1', 'create_task')).toBe(true);
    expect(await service.isToolEnabled('u1', 'calendar_create_event')).toBe(false);
  });

  it('never gates a tool that belongs to no skill', async () => {
    const { service } = buildService();
    expect(await service.isToolEnabled('u1', 'unmapped_tool')).toBe(true);
  });
});
