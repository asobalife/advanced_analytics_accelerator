import * as b64 from "base64-url"
import * as chai from "chai"
import * as sinon from "sinon"

import concatStream = require("concat-stream")

import * as Hub from "../../../../hub"

import { ActionCrypto } from "../../../../hub"
import { GoogleSheetsAction } from "./google_sheets"

const action = new GoogleSheetsAction()
action.executeInOwnProcess = false

const stubFileName = "stubSuggestedFilename"
const stubFolder = "stubSuggestedFolder"

function expectGoogleSheetsMatch(request: Hub.ActionRequest, paramsMatch: any) {

  const expectedBuffer = paramsMatch.media.body
  delete paramsMatch.media.body

  const createSpy = sinon.spy(async (params: any) => {
    params.media.body.pipe(concatStream((buffer) => {
      chai.expect(buffer.toString()).to.equal(expectedBuffer.toString())
    }))
    return { promise: async () => Promise.resolve() }
  })

  const stubClient = sinon.stub(action as any, "driveClientFromRequest")
    .resolves({
      files: {
        create: createSpy,
      },
    })

  return chai.expect(action.validateAndExecute(request)).to.be.fulfilled.then(() => {
    chai.expect(createSpy).to.have.been.called
    stubClient.restore()
  })
}

describe(`${action.constructor.name} unit tests`, () => {
  let encryptStub: any
  let decryptStub: any

  beforeEach(() => {
    encryptStub = sinon.stub(ActionCrypto.prototype, "encrypt").callsFake( async (s: string) => b64.encode(s) )
    decryptStub = sinon.stub(ActionCrypto.prototype, "decrypt").callsFake( async (s: string) => b64.decode(s) )
  })

  afterEach(() => {
    encryptStub.restore()
    decryptStub.restore()
  })

  describe("action", () => {
    describe("execute", () => {

      it("successfully interprets execute request params", () => {
        const request = new Hub.ActionRequest()
        const dataBuffer = Buffer.from("Hello")
        request.type = Hub.ActionType.Query
        request.attachment = {dataBuffer, fileExtension: "csv"}
        request.formParams = {filename: stubFileName, folder: stubFolder}
        request.params = {
          state_url: "https://looker.state.url.com/action_hub_state/asdfasdfasdfasdf",
          state_json: JSON.stringify({tokens: "access", redirect: "url"}),
        }
        return expectGoogleSheetsMatch(request, {
          requestBody: {
            name: stubFileName,
            mimeType: "application/vnd.google-apps.spreadsheet",
            parents: [stubFolder],
          },
          media: {
            body: dataBuffer,
          },
        })
      })

      it("uses sheets overwrite code if overwrite is true and a file exists", (done) => {
        const stubDriveClient = sinon.stub(action as any, "driveClientFromRequest")
          .resolves({
            files: {
              list: async () => Promise.resolve({
                data: {
                  files: [
                    {
                      id: "fake_id",
                      name: "random_sheet",
                    },
                  ],
                },
              }),
            },
          })
        const flushSpy = sinon.spy(async (buffer: any, _sheet: any, _spreadsheetId: number) => {
          chai.expect(buffer).to.deep.equal({
            requests: [
              {
                pasteData: {
                  coordinate: {
                    sheetId: 1,
                    columnIndex: 0,
                    rowIndex: 0,
                  },
                  data: "a,b,c",
                  delimiter: ",",
                  type: "PASTE_NORMAL",
                },
              }, {
                pasteData: {
                  coordinate: {
                    sheetId: 1,
                    columnIndex: 0,
                    rowIndex: 1,
                  },
                  data: "1,2,3",
                  delimiter: ",",
                  type: "PASTE_NORMAL",
                },
              },
            ],
          })
          return Promise.resolve({})
        })
        const stubFlush = sinon.stub(action as any, "flush").callsFake(flushSpy)
        const stubSheetClient = sinon.stub(action as any, "sheetsClientFromRequest")
          .resolves({
            spreadsheets: {
              get: async () => Promise.resolve({
                data: {
                  sheets: [
                    {
                      properties: {
                        sheetId: 1,
                        gridProperties: {
                          rowCount: 5,
                        },
                      },
                    },
                  ],
                },
              }),
              values: {
                clear: async () => Promise.resolve(),
              },
            },
          })
        const csvFile = "a,b,c\n1,2,3"

        const request = new Hub.ActionRequest()
        request.attachment = {dataBuffer: Buffer.from(csvFile), fileExtension: "csv"}
        request.formParams = {overwrite: "yes", filename: "random_sheet", folder: "folder"}
        request.type = Hub.ActionType.Query
        request.params = {
          state_url: "https://looker.state.url.com/action_hub_state/asdfasdfasdfasdf",
          state_json: `{"tokens": {"access_token": "token"}, "redirect": "fake.com"}`,
        }
        chai.expect(action.validateAndExecute(request)).to.eventually.be.fulfilled.then( () => {
          chai.expect(flushSpy).to.have.been.calledOnce
          stubDriveClient.restore()
          stubSheetClient.restore()
          stubFlush.restore()
          done()
        })

      })

      it("uses will correctly sanitize values for csv uploads", (done) => {
        const stubDriveClient = sinon.stub(action as any, "driveClientFromRequest")
          .resolves({
            files: {
              list: async () => Promise.resolve({
                data: {
                  files: [
                    {
                      id: "fake_id",
                      name: "random_sheet",
                    },
                  ],
                },
              }),
            },
          })
        const flushSpy = sinon.spy(async (buffer: any, _sheet: any, _spreadsheetId: number) => {
          chai.expect(buffer.requests[0].pasteData.data).to.eq("\"a\",\"b\",\"lol\"\"\",\"c\"")
          return Promise.resolve({})
        })
        const stubFlush = sinon.stub(action as any, "flush").callsFake(flushSpy)
        const stubSheetClient = sinon.stub(action as any, "sheetsClientFromRequest")
          .resolves({
            spreadsheets: {
              get: async () => Promise.resolve({
                data: {
                  sheets: [
                    {
                      properties: {
                        sheetId: 1,
                        gridProperties: {
                          rowCount: 5,
                        },
                      },
                    },
                  ],
                },
              }),
              values: {
                clear: async () => Promise.resolve(),
              },
            },
          })
        const csvFile = "\"a\",\"b\",\"lol\"\"\",\"c\"\n1,2,3,4"

        const request = new Hub.ActionRequest()
        request.attachment = {dataBuffer: Buffer.from(csvFile), fileExtension: "csv"}
        request.formParams = {overwrite: "yes", filename: "random_sheet", folder: "folder"}
        request.type = Hub.ActionType.Query
        request.params = {
          state_url: "https://looker.state.url.com/action_hub_state/asdfasdfasdfasdf",
          state_json: `{"tokens": {"access_token": "token"}, "redirect": "fake.com"}`,
        }
        const requestResult = action.validateAndExecute(request)
        chai.expect(requestResult).to.eventually.have.property("success", true)
          .then( () => {
          chai.expect(flushSpy).to.have.been.calledOnce
          chai.expect(flushSpy).to.not.have.thrown
          stubDriveClient.restore()
          stubSheetClient.restore()
          stubFlush.restore()
          done()
        })

      })

      it("uses senddata if overwrite is false", (done) => {
        const stubDriveClient = sinon.stub(action as any, "driveClientFromRequest")
          .resolves({
            files: {
              list: async () => Promise.resolve({
                data: {
                  files: [],
                },
              }),
            },
          })
        const stubSheetClient = sinon.stub(action as any, "sheetsClientFromRequest")
          .resolves({
            spreadsheets: {
              get: async () => Promise.resolve({
                data: {
                  sheets: [
                    {
                      properties: {
                        sheetId: 1,
                        gridProperties: {
                          rowCount: 5,
                        },
                      },
                    },
                  ],
                },
              }),
              values: {
                clear: async () => Promise.resolve(),
              },
            },
          })
        const csvFile = "a,b,c\n1,2,3"
        const overwriteSpy = sinon.spy()
        const overwriteStub = sinon.stub(action as any, "sendOverwriteData").callsFake(overwriteSpy)
        const sendSpy = sinon.spy()
        const sendStub = sinon.stub(action as any, "sendData").callsFake(sendSpy)

        const request = new Hub.ActionRequest()
        request.attachment = {dataBuffer: Buffer.from(csvFile), fileExtension: "csv"}
        request.formParams = {overwrite: "false", filename: "random_sheet", folder: "folder"}
        request.type = Hub.ActionType.Query
        request.params = {
          state_url: "https://looker.state.url.com/action_hub_state/asdfasdfasdfasdf",
          state_json: `{"tokens": {"access_token": "token"}, "redirect": "fake.com"}`,
        }
        chai.expect(action.validateAndExecute(request)).to.eventually.be.fulfilled.then( () => {
          chai.expect(sendSpy).to.have.been.calledOnce
          chai.expect(overwriteStub).to.not.have.been.called
          stubDriveClient.restore()
          stubSheetClient.restore()
          sendStub.restore()
          overwriteStub.restore()
          done()
        })
      })

      it("uses sheets overwrite code if overwrite is true but the file does not exist", (done) => {
        const stubDriveClient = sinon.stub(action as any, "driveClientFromRequest")
          .resolves({
            files: {
              list: async () => Promise.resolve({
                data: {
                  files: [],
                },
              }),
            },
          })
        const stubSheetClient = sinon.stub(action as any, "sheetsClientFromRequest")
          .resolves({
            spreadsheets: {
              get: async () => Promise.resolve({
                data: {
                  sheets: [
                    {
                      properties: {
                        sheetId: 1,
                        gridProperties: {
                          rowCount: 5,
                        },
                      },
                    },
                  ],
                },
              }),
              values: {
                clear: async () => Promise.resolve(),
              },
            },
          })
        const csvFile = "a,b,c\n1,2,3"
        const sendSpy = sinon.spy()
        const sendStub = sinon.stub(action as any, "sendData").callsFake(sendSpy)

        const request = new Hub.ActionRequest()
        request.attachment = {dataBuffer: Buffer.from(csvFile), fileExtension: "csv"}
        request.formParams = {overwrite: "yes", filename: "random_sheet", folder: "folder"}
        request.type = Hub.ActionType.Query
        request.params = {
          state_url: "https://looker.state.url.com/action_hub_state/asdfasdfasdfasdf",
          state_json: `{"tokens": {"access_token": "token"}, "redirect": "fake.com"}`,
        }
        chai.expect(action.validateAndExecute(request)).to.eventually.be.fulfilled.then( () => {
          chai.expect(sendSpy).to.have.been.calledOnce
          stubDriveClient.restore()
          stubSheetClient.restore()
          sendStub.restore()
          done()
        })
      })
    })

    describe("form", () => {
      it("adds option for overwrite", (done) => {
        const stubClient = sinon.stub(action as any, "driveClientFromRequest")
          .resolves({
            files: {
              list: async () => Promise.resolve({
                data: {
                  files: [
                    {
                      id: "fake_id",
                      name: "fake_name",
                    },
                  ],
                },
              }),
            },
            drives: {
              list: async () => Promise.resolve({
                data: {
                  drives: [
                    {
                      id: "fake_drive",
                      name: "fake_drive_label",
                    },
                  ],
                },
              }),
            },
          })
        const request = new Hub.ActionRequest()
        request.params = {
          state_url: "https://looker.state.url.com/action_hub_state/asdfasdfasdfasdf",
          state_json: JSON.stringify({tokens: "access", redirect: "url"}),
        }
        const form = action.validateAndFetchForm(request)
        chai.expect(form).to.eventually.deep.equal({
          fields: [{
            description: "Google Drive where your file will be saved",
            label: "Select Drive to save file",
            name: "drive",
            options: [{name: "mydrive", label: "My Drive"}, {name: "fake_drive", label: "fake_drive_label"}],
            default: "mydrive",
            interactive: true,
            required: true,
            type: "select",
          }, {
            description: "Google Drive folder where your file will be saved",
            label: "Select folder to save file",
            name: "folder",
            options: [{name: "root", label: "Drive Root"}, { name: "fake_id", label: "fake_name" }],
            default: "root",
            required: true,
            type: "select",
          }, {
            label: "Enter a name",
            name: "filename",
            type: "string",
            required: true,
          }, {
            default: "yes",
            description: "Should this action attempt to overwrite an existing file",
            label: "Overwrite Existing Files",
            name: "overwrite",
            options: [
              {
                label: "Yes",
                name: "yes",
              }, {
                label: "No",
                name: "no",
              },
            ],
            required: true,
            type: "select",
          }],
          state: {
            data: JSON.stringify({tokens: "access", redirect: "url"}),
          },
        }).and.notify(stubClient.restore).and.notify(done)
      })
    })
  })
})
