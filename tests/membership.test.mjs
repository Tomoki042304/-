import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isActiveMembership } from '../src/lib/membership.ts'

const row = { user_id: 'user-a', member_id: 'SR-001', role: 'member', status: 'active' }

test('allows only a validated active membership belonging to the current user', () => {
  assert.equal(isActiveMembership(row, 'user-a'), true)
  assert.equal(isActiveMembership({ ...row, role: 'admin' }, 'user-a'), true)
})

test('denies absent, suspended, foreign, or malformed membership data', () => {
  for (const value of [null, undefined, {}, { ...row, status: 'suspended' },
    { ...row, user_id: 'user-b' }, { ...row, role: 'owner' },
    { ...row, member_id: '' }, { ...row, member_id: null }, { ...row, status: null }]) {
    assert.equal(isActiveMembership(value, 'user-a'), false)
  }
})
