/**
 * Unit tests for learning time utils (pure functions and service behaviour).
 */
import { describe, it, expect } from 'vitest'
import { formatLearningTime } from '../../frontend/src/utils/learningTime.js'

describe('formatLearningTime', () => {
  it('returns "0 min" for zero or negative', () => {
    expect(formatLearningTime(0)).toBe('0 min')
    expect(formatLearningTime(-1)).toBe('0 min')
    expect(formatLearningTime(null)).toBe('0 min')
    expect(formatLearningTime(undefined)).toBe('0 min')
  })

  it('formats minutes only when under one hour', () => {
    expect(formatLearningTime(60)).toBe('1 min')
    expect(formatLearningTime(45 * 60)).toBe('45 min')
    expect(formatLearningTime(59 * 60)).toBe('59 min')
  })

  it('formats hours only when exact hours', () => {
    expect(formatLearningTime(3600)).toBe('1 h')
    expect(formatLearningTime(2 * 3600)).toBe('2 h')
  })

  it('formats hours and minutes when both present', () => {
    expect(formatLearningTime(3600 + 30 * 60)).toBe('1 h 30 min')
    expect(formatLearningTime(2 * 3600 + 15 * 60)).toBe('2 h 15 min')
  })
})
