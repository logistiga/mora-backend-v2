import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { SKILL_CATALOG, findSkillDefinition, skillKeyForTool, type SkillDefinition } from './skill-catalog.js';

export interface UserSkillView {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  toolNames: readonly string[];
}

/**
 * Per-user on/off state for the code-defined skill catalog. A missing row
 * means enabled, so every existing user keeps today's behaviour with no
 * backfill. Only the disabled state is ever a row of its own.
 */
@Injectable()
export class UserSkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<UserSkillView[]> {
    const rows = await this.prisma.userSkill.findMany({ where: { userId } });
    const enabledByKey = new Map(rows.map((row) => [row.skillKey, row.enabled]));
    return SKILL_CATALOG.map((skill) => this.toView(skill, enabledByKey.get(skill.key) ?? true));
  }

  async setEnabled(userId: string, key: string, enabled: boolean): Promise<UserSkillView> {
    const skill = findSkillDefinition(key);
    if (!skill) {
      throw new NotFoundException(`Unknown skill "${key}"`);
    }

    await this.prisma.userSkill.upsert({
      where: { userId_skillKey: { userId, skillKey: key } },
      create: { userId, skillKey: key, enabled },
      update: { enabled },
    });

    return this.toView(skill, enabled);
  }

  /** Tool names the user has switched off — used to hide them from the LLM. */
  async disabledToolNames(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.userSkill.findMany({
      where: { userId, enabled: false },
      select: { skillKey: true },
    });
    const disabled = new Set<string>();
    for (const row of rows) {
      const skill = findSkillDefinition(row.skillKey);
      for (const toolName of skill?.toolNames ?? []) disabled.add(toolName);
    }
    return disabled;
  }

  /** Tools that belong to no skill are never gated; coverage is enforced by the catalog test. */
  async isToolEnabled(userId: string, toolName: string): Promise<boolean> {
    const skillKey = skillKeyForTool(toolName);
    if (!skillKey) return true;
    const row = await this.prisma.userSkill.findUnique({
      where: { userId_skillKey: { userId, skillKey } },
      select: { enabled: true },
    });
    return row?.enabled ?? true;
  }

  private toView(skill: SkillDefinition, enabled: boolean): UserSkillView {
    return {
      key: skill.key,
      label: skill.label,
      description: skill.description,
      enabled,
      toolNames: skill.toolNames,
    };
  }
}
