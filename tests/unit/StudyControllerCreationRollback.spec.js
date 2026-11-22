import StudyController from '@/controllers/StudyController'

const mockCreateStudy = jest.fn()
const mockDeleteStudy = jest.fn()
const mockCreateAnswer = jest.fn()
const mockLinkAnswer = jest.fn()
const mockDeleteAnswer = jest.fn()

jest.mock('@/app/plugins/firebase/FirebaseFirestoreRepository', () => {
  return class {
    create(...args) {
      return mockCreateStudy(...args)
    }

    delete(...args) {
      return mockDeleteStudy(...args)
    }
  }
})

jest.mock('@/shared/controllers/AnswerController', () => {
  return class {
    createAnswer(...args) {
      return mockCreateAnswer(...args)
    }

    linkAnswerToStudy(...args) {
      return mockLinkAnswer(...args)
    }

    delete(...args) {
      return mockDeleteAnswer(...args)
    }
  }
})

jest.mock('@/features/auth/controllers/UserController', () => class {})
jest.mock('@/shared/models/StudyAnswer', () => {
  return class {
    constructor(data) {
      Object.assign(this, data)
    }
  }
})
jest.mock('@/shared/models/Participant', () => class {})
jest.mock('@/shared/constants/methodDefinitions', () => ({
  instantiateStudyByType: jest.fn(),
}))
jest.mock('@/app/plugins/firebase/FirebaseFunctionsService', () => ({
  FirebaseFunctionsController: {},
}))
jest.mock('@/app/plugins/firebase', () => ({ db: {} }))
jest.mock('firebase/firestore', () => ({}))
jest.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'owner-1' } }),
}))

describe.each(['createStudy', 'duplicateStudy'])('%s rollback', (method) => {
  let controller
  let study
  let payload

  beforeEach(() => {
    mockCreateAnswer.mockResolvedValue({ id: 'answer-1' })
    mockCreateStudy.mockResolvedValue({ id: 'study-1' })
    mockLinkAnswer.mockResolvedValue()
    mockDeleteAnswer.mockResolvedValue()
    mockDeleteStudy.mockResolvedValue()
    controller = new StudyController()
    study = {
      testType: 'USER',
      toFirestore: jest.fn(() => ({ answersDocId: study.answersDocId })),
    }
    payload = method === 'createStudy' ? study : { test: study }
  })

  it('creates and links the study without deleting either document', async () => {
    await expect(controller[method](payload)).resolves.toEqual({
      id: 'study-1',
    })
    expect(mockCreateStudy).toHaveBeenCalledWith('tests', {
      answersDocId: 'answer-1',
    })
    expect(mockLinkAnswer).toHaveBeenCalledWith('answer-1', 'study-1')
    expect(mockDeleteAnswer).not.toHaveBeenCalled()
    expect(mockDeleteStudy).not.toHaveBeenCalled()
  })

  it('does not delete documents when the initial answers write fails', async () => {
    const error = new Error('Answers write failed')
    mockCreateAnswer.mockRejectedValueOnce(error)

    await expect(controller[method](payload)).rejects.toBe(error)
    expect(mockCreateStudy).not.toHaveBeenCalled()
    expect(mockDeleteAnswer).not.toHaveBeenCalled()
    expect(mockDeleteStudy).not.toHaveBeenCalled()
  })

  it('deletes the answers document when creating the study fails', async () => {
    const error = new Error('Study write failed')
    mockCreateStudy.mockRejectedValueOnce(error)

    await expect(controller[method](payload)).rejects.toBe(error)
    expect(mockDeleteAnswer).toHaveBeenCalledWith('answers', 'answer-1')
    expect(mockDeleteStudy).not.toHaveBeenCalled()
  })

  it('deletes the answers document when serializing the study fails', async () => {
    const error = new Error('Serialization failed')
    study.toFirestore.mockImplementationOnce(() => {
      throw error
    })

    await expect(controller[method](payload)).rejects.toBe(error)
    expect(mockCreateStudy).not.toHaveBeenCalled()
    expect(mockDeleteAnswer).toHaveBeenCalledWith('answers', 'answer-1')
    expect(mockDeleteStudy).not.toHaveBeenCalled()
  })

  it('deletes both documents when linking them fails', async () => {
    const error = new Error('Link failed')
    mockLinkAnswer.mockRejectedValueOnce(error)

    await expect(controller[method](payload)).rejects.toBe(error)
    expect(mockDeleteAnswer).toHaveBeenCalledWith('answers', 'answer-1')
    expect(mockDeleteStudy).toHaveBeenCalledWith('tests', 'study-1')
  })

  it('preserves the study-write error when answers cleanup also fails', async () => {
    const error = new Error('Study write failed')
    mockCreateStudy.mockRejectedValueOnce(error)
    mockDeleteAnswer.mockRejectedValueOnce(new Error('Cleanup failed'))

    await expect(controller[method](payload)).rejects.toBe(error)
    expect(mockDeleteAnswer).toHaveBeenCalledWith('answers', 'answer-1')
  })

  it('preserves the link error when both cleanup operations fail', async () => {
    const error = new Error('Link failed')
    mockLinkAnswer.mockRejectedValueOnce(error)
    mockDeleteAnswer.mockRejectedValueOnce(new Error('Answers cleanup failed'))
    mockDeleteStudy.mockRejectedValueOnce(new Error('Study cleanup failed'))

    await expect(controller[method](payload)).rejects.toBe(error)
    expect(mockDeleteAnswer).toHaveBeenCalledWith('answers', 'answer-1')
    expect(mockDeleteStudy).toHaveBeenCalledWith('tests', 'study-1')
  })
})
