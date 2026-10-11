import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => void store.set(k, v) },
}));

const { demoApi, demoAuth } = await import('../../../apps/mobile/src/demoApi');
const today = new Date().toISOString().slice(0, 10);

describe('on-device demo backend mirrors the real rules', () => {
  it('register → log → limits → verification adds no points → rankings → delete', async () => {
    await demoAuth('/auth/register', { email: 'a@b.com', password: 'correct-horse-battery', inviteCode: 'X', adultConfirmed: true, pseudonym: 'tester_one', tradition: 'islam', uiLanguage: 'ar' });
    const cat = await demoApi('/catalogue');
    expect(cat.items.length).toBe(14);
    const log = (id: string, extra = {}) => demoApi('/logs', { json: { activityId: id, localDate: today, tz: 'UTC', idempotencyKey: Math.random().toString(36).slice(2) + 'xxxx', ...extra } });
    expect((await log('islam.character.parents')).pointsAwarded).toBe(5);
    await expect(log('islam.character.parents')).rejects.toMatchObject({ code: 'daily_limit' });
    await expect(log('christianity.prayer.personal')).rejects.toMatchObject({ code: 'activity_not_found' });
    await expect(demoApi('/logs', { json: { activityId: 'islam.worship.dhikr', localDate: '2000-01-01', tz: 'UTC', idempotencyKey: 'abcdefgh1' } })).rejects.toMatchObject({ code: 'too_old' });
    const ms = await log('islam.quran.memorize_milestone', { milestoneKey: 'p1' });
    await expect(log('islam.quran.memorize_milestone', { milestoneKey: 'p1' })).rejects.toMatchObject({ code: 'milestone_done' });
    await demoApi('/leaderboards/A/membership', { method: 'POST', json: { consent: true } });
    await demoApi('/leaderboards/B/membership', { method: 'POST', json: { consent: true } });
    expect((await demoApi('/leaderboards/A?period=weekly')).me.points).toBe(20);
    expect((await demoApi('/leaderboards/B?period=weekly')).me).toBeNull();

    await demoApi('/me/consents', { json: { type: 'evidence', granted: true } });
    const form = { _parts: [['logId', ms.logId], ['file', {}]] } as unknown as FormData;
    await demoApi('/verification/submissions', { form });
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 7000);
    let subs = (await demoApi('/verification/submissions')).submissions;
    expect(subs[0].status).toBe('unable_to_verify'); // first attempt exercises retry/appeal
    expect((await demoApi('/dashboard')).totals.lifetime).toEqual({ eligible: 20, verified: 0 });
    await demoApi(`/verification/submissions/${subs[0].id}/appeal`, { json: {} });
    vi.setSystemTime(Date.now() + 7000);
    subs = (await demoApi('/verification/submissions')).submissions;
    vi.useRealTimers();
    expect(subs[0].status).toBe('verified');
    expect((await demoApi('/dashboard')).totals.lifetime).toEqual({ eligible: 20, verified: 15 }); // no bonus points
    expect((await demoApi('/leaderboards/A?period=weekly')).me.points).toBe(20);
    expect((await demoApi('/leaderboards/B?period=weekly')).me.points).toBe(15);
    await demoApi('/me', { method: 'DELETE' });
    await expect(demoApi('/me')).rejects.toMatchObject({ status: 401 });
  });
});
