import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { SKILL_CATALOG, findSkillDefinition, skillKeyForTool, type SkillDefinition } from './skill-catalog.js';

export interface UserSkillView {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  toolNames: readonly string[];
  config?: Record<string, string>;
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
    const byKey = new Map(rows.map((row) => [row.skillKey, row]));
    return SKILL_CATALOG.map((skill) => {
      const row = byKey.get(skill.key);
      const stored = Object.fromEntries(
        Object.entries((row?.config ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>;
      return { ...this.toView(skill, row?.enabled ?? true), config: { ...this.defaultConfig(skill.key), ...stored } };
    });
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

  async getConfig(userId: string, key: string): Promise<Record<string, string>> {
    const row = await this.prisma.userSkill.findUnique({
      where: { userId_skillKey: { userId, skillKey: key } },
      select: { config: true },
    });
    const stored = (row?.config ?? {}) as Record<string, unknown>;
    const defaults = this.defaultConfig(key);
    return { ...defaults, ...(Object.fromEntries(Object.entries(stored).filter(([, v]) => typeof v === 'string')) as Record<string, string>) };
  }

  async setConfig(userId: string, key: string, config: Record<string, unknown>): Promise<Record<string, string>> {
    const skill = findSkillDefinition(key);
    if (!skill) throw new NotFoundException(`Unknown skill "${key}"`);
    const options = skill.configOptions ?? {};
    for (const [name, value] of Object.entries(config)) {
      const allowed = options[name];
      if (!allowed || typeof value !== 'string' || !allowed.includes(value)) {
        throw new BadRequestException(`Invalid config "${name}" for skill "${key}"`);
      }
    }
    const merged: Record<string, string> = { ...(await this.getConfig(userId, key)), ...(config as Record<string, string>) };
    await this.prisma.userSkill.upsert({
      where: { userId_skillKey: { userId, skillKey: key } },
      create: { userId, skillKey: key, enabled: true, config: merged as Prisma.InputJsonValue },
      update: { config: merged as Prisma.InputJsonValue },
    });
    return merged;
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

  private defaultConfig(key: string): Record<string, string> {
    if (key === 'calendar') return { provider: 'mora' };
    return {};
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
