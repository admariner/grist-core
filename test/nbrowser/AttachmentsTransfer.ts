import {AttachmentsArchiveParams, DocAPI} from 'app/common/UserAPI';
import fs from 'fs';
import {assert, driver, Key, WebElementPromise} from 'mocha-webdriver';
import path from 'path';
import {enableExternalAttachmentsForTestSuite} from 'test/nbrowser/externalAttachmentsHelpers';
import * as gu from 'test/nbrowser/gristUtils';
import {fileDialogUpload, TestUser} from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {createTmpDir} from 'test/server/docTools';
import axios from 'axios';
import stream from 'node:stream';
import fse from 'fs-extra';

describe("AttachmentsTransfer", function() {
  this.timeout('6m');
  const cleanup = setupTestSuite();
  let docId: string;
  let session: gu.Session;
  let tmpDownloadsFolder: string;
  let reqHeaders: { Authorization: string } | undefined;
  let api: DocAPI;


  before(async function() {
    tmpDownloadsFolder = await createTmpDir();

    session = await gu.session().teamSite.login();
    reqHeaders = {
      Authorization: `Bearer ${session.getApiKey()}`
    };
  });

  afterEach(async function() {
    await gu.checkForErrors();
    await driver.sendKeys(Key.ESCAPE);
  });

  describe("without external attachments enabled", () => {
    it('should show message that transfers are not configured', async function() {
      docId = await session.tempNewDoc(cleanup);
      api = session.createHomeApi().getDocAPI(docId);

      // Open document settings.
      await gu.openDocumentSettings();

      // We should see 1 message about no stores.
      await gu.waitToPass(async () => assert.lengthOf(await messages(), 1));
      assert.isTrue(await noStoresWarning().isDisplayed());
    });

    it('should hide section for non owner', async function() {
      // Now login as editor and viewer, and make sure section is hidden.
      const homeApi = session.createHomeApi();
      await homeApi.updateDocPermissions(docId, {
        users: {
          [gu.translateUser("user2").email]: 'viewers',
          [gu.translateUser("user3").email]: 'editors'
        }
      });

      async function checkFor(user: TestUser) {
        const s = await gu.session().teamSite.user(user).login();
        await s.loadRelPath(`/doc/${docId}`);
        await gu.openDocumentSettings();
        await driver.findWait('.test-admin-panel-item-timezone', 1000);
        await waitForNotPresent(attachmentSection);
      }

      await checkFor('user2');
      await checkFor('user3');

      await session.login();
      await session.loadRelPath(`/doc/${docId}`);
    });
  });

  describe("with external attachments enabled", () => {
    const externalAttachments = enableExternalAttachmentsForTestSuite({transferDelay: 500});

    /** Files will be stored in a folder inside the tmpFolder. Here is a helper that will get files names from it. */
    const files = () => {
      const tmpAttachmentsFolder = externalAttachments.getAttachmentsDir();
      const isDir = (f: string) => fs.statSync(path.join(tmpAttachmentsFolder, f)).isDirectory();
      const dirs = fs.readdirSync(tmpAttachmentsFolder).filter(isDir);
      if (dirs.length === 0) { return []; }
      if (dirs.length > 1) { throw new Error("Unexpected number of directories"); }
      return fs.readdirSync(path.join(tmpAttachmentsFolder, dirs[0]));
    };

    it("should show transfer menu", async function () {
      await session.loadRelPath(`/doc/${docId}`);

      // Open document settings.
      await gu.openDocumentSettings();

      // Storage type should be set to Internal
      assert.equal(await storageType.value(), 'Internal');

      // We should see Internal and External options in the storage type dropdown.
      assert.deepEqual(await storageType.options(), ['Internal', 'External']);

      // Now change to internal.
      await storageType.select('External');

      // The value now should be External.
      assert.equal(await storageType.value(), 'External');

      // We shouldn't see any info as there are no attachments yet.
      assert.lengthOf(await messages(), 0);

      // Go back to internal.
      await storageType.select('Internal');
    });

    it("should show actions when some attachments are added", async function () {
      // Upload four attachments.
      await gu.openPage('Table1');
      await gu.selectColumn('A');
      await gu.setType('Attachment');
      await gu.toggleSidePanel('right', 'close');
      await addRow();
      const cell = await gu.getCell('A', 1);
      await gu.openUploadDialog(cell);
      await gu.uploadFiles('uploads/file1.mov', 'uploads/file2.mp3', 'uploads/file3.zip', 'uploads/simple_array.json');
      await gu.waitForAttachments(cell, 4);

      // Now switch to external to test the copy.
      await gu.openDocumentSettings();
      await gu.toggleSidePanel('left', 'close');
      await storageType.select('External');

      // We should see a message about attachments being still internal.
      assert.lengthOf(await messages(), 1);
      assert.isTrue(await internalCopy().isDisplayed());

      // We should see start transfer button.
      assert.isTrue(await startTransferButton().isDisplayed());

      // When we switch back to internal, the message should be gone.
      await storageType.select('Internal');
      assert.lengthOf(await messages(), 0);
      assert.isFalse(await startTransferButton().isPresent());

      // Now switch back to external.
      await storageType.select('External');
      assert.lengthOf(await messages(), 1);
      assert.isTrue(await internalCopy().isDisplayed());
      assert.isTrue(await startTransferButton().isDisplayed());
    });

    it('should transfer files to external storage', async function () {
      // First make sure that the tmp folder is empty.
      assert.lengthOf(files(), 0);

      // Start transfer.
      await startTransferButton().click();
      await gu.waitForServer();

      // We should see transfer spinner.
      await waitForDisplay(transferSpinner);

      // Wait for the spinner to disappear.
      await waitForNotPresent(transferSpinner);

      // We now should have those files transfer.
      assert.lengthOf(files(), 4);

      // We are not testing here if transfer works or not, just the correct number of files is enough.

      // Make sure that transfer button is gone.
      assert.isFalse(await startTransferButton().isPresent());

      // And we don't have any messages.
      assert.lengthOf(await messages(), 0);
    });

    it('warns users downloading the doc that attachments are external', async function () {
      try {
        await driver.find('.test-tb-share').click();
        await driver.findContentWait('.test-tb-share-option', /Download document/, 5000).click();
        const attachmentsMsg = await driver.findWait('.test-external-attachments-info', 1000).getText();

        assert.match(attachmentsMsg, /Attachments are external/, "should be informed attachments aren't included");

        const downloadHref = await driver.find('.test-external-attachments-info a').getAttribute('href');
        const downloadUrl = new URL(downloadHref);
        const idealUrl = new URL(api.getDownloadAttachmentsArchiveUrl({format: 'tar'}));
        assert.equal(downloadUrl.pathname, idealUrl.pathname, "wrong download link called");
        assert.equal(downloadUrl.search, idealUrl.search, "wrong search parameters in url");
        // Ensures the page isn't modified / navigated away from by the link, as subsequent tests will fail.
        await driver.find('.test-external-attachments-info a').click();
      } finally {
        // Try to close the modal to minimise the chances of other tests failing.
        await driver.findContent("button", "Cancel").click();
      }
    });

    it('can download attachments', async function () {
      try {
        await driver.find('.test-tb-share').click();
        await driver.findContentWait('.test-tb-share-option', /Download attachments/, 5000).click();
        const attachmentsStatus = await driver.findWait('.test-attachments-external-message', 1000).getText();

        assert.match(attachmentsStatus, /in the ".tar" format/, "users should be advised to use .tar");

        const selectFormat = async (formatRegex: RegExp) => {
          await driver.findWait('.test-attachments-format-select', 500).click();
          await driver.findContentWait('.test-attachments-format-options .test-select-row', formatRegex, 500).click();
        };

        const testDownloadLink = async (params: AttachmentsArchiveParams) => {
          const downloadUrl = new URL(await driver.find('.test-download-attachments-button-link').getAttribute('href'));
          const idealUrl = new URL(api.getDownloadAttachmentsArchiveUrl(params));
          assert.equal(downloadUrl.pathname, idealUrl.pathname, "wrong download link called");
          assert.equal(downloadUrl.search, idealUrl.search, "wrong search parameters in url");
          const response = await axios.get(downloadUrl.toString(), {
            headers: reqHeaders,
            responseType: "stream"
          });
          // Download the file so we've got a copy available for uploading.
          const fileName = `attachments.${params.format}`;
          assert.notInclude(await fse.readdir(tmpDownloadsFolder), fileName, "attachments file shouldn't exist yet");
          await stream.promises.pipeline(
            response.data,
            fs.createWriteStream(path.join(tmpDownloadsFolder, fileName))
          );
          assert.include(await fse.readdir(tmpDownloadsFolder), fileName, "attachments file wasn't downloaded");
        };


        await selectFormat(/.tar/);
        await gu.waitToPass(() => testDownloadLink({format: 'tar'}), 500);
        await selectFormat(/.zip/);
        await gu.waitToPass(() => testDownloadLink({format: 'zip'}), 500);
      } finally {
        // Try to close the modal to minimise the chances of other tests failing.
        await driver.findContent("button", "Cancel").click();
      }
    });

    it('can upload attachments', async function () {
      const file = path.join(tmpDownloadsFolder, 'attachments.tar');
      await fileDialogUpload(file, async () => {
        await driver.find('.test-settings-upload-attachment-archive').click();
      });
      assert.match(
        await driver.findWait('.test-notifier-toast-message', 1000).getText(),
        // Only care that the request is made, and that the UI behaves as expected.
        // Don't care about checking attachments reconnect behaviour - API tests cover that.
        /0 attachment files reconnected/
      );
      await driver.findWait('.test-notifier-toast-close', 2000).click();
    });

    it('should transfer files to internal storage', async function () {
      // Switch to internal.
      await storageType.select('Internal');

      // We should see new copy and transfer button.
      assert.lengthOf(await messages(), 1);
      assert.isFalse(await internalCopy().isPresent());
      assert.isTrue(await externalCopy().isDisplayed());
      assert.isTrue(await startTransferButton().isDisplayed());

      // Switching back hides everything.
      await storageType.select('External');
      assert.lengthOf(await messages(), 0);
      assert.isFalse(await startTransferButton().isPresent());

      // Switch back to internal.
      await storageType.select('Internal');

      // Start transfer.
      await startTransferButton().click();

      // We should see transfer spinner.
      assert.isTrue(await transferSpinner(WAIT).isDisplayed());

      // Wait for the spinner to disappear.
      await gu.waitToPass(async () => assert.isFalse(await transferSpinner().isPresent()));
      await gu.waitForServer();

      // We should see that internal storage is selected.
      assert.equal(await storageType.value(), 'Internal');

      // And we don't have any messages here.
      assert.lengthOf(await messages(), 0);

      // Even after reload.
      await driver.navigate().refresh();
      await storageType.waitForDisplay();
      assert.lengthOf(await messages(), 0);
      assert.equal(await storageType.value(), 'Internal');
    });


    // Here we do the same stuff but with the API calls, and we expect that the UI will react to it.
    it('user should be able to observe background actions', async function () {
      // Sanity check.
      assert.equal(await storageType.value(), 'Internal');

      // Set to external.
      await api.setAttachmentStore('external');

      // The value should be changed.
      await storageType.waitForValue('External');

      // We should see the message.
      assert.lengthOf(await messages(), 1);
      assert.isTrue(await internalCopy().isDisplayed());
      // And the button to start transfer.
      assert.isTrue(await startTransferButton().isDisplayed());

      // Move back to internal and check that the message is gone.
      await api.setAttachmentStore('internal');
      await storageType.waitForValue('Internal');
      assert.lengthOf(await messages(), 0);
      assert.isFalse(await startTransferButton().isPresent());

      // Set to external again.
      await api.setAttachmentStore('external');
      await storageType.waitForValue('External');
      await waitForDisplay(startTransferButton);

      // We are seeing that some files are internal.
      assert.isTrue(await internalCopy().isDisplayed());

      // The copy version is static.
      assert.isTrue(await internalCopy().isStatic());

      // And start transfer.
      await api.transferAllAttachments();

      // Wait for the spinner to be shown.
      await waitForDisplay(transferSpinner);

      // The internal copy should be changed during the transfer.
      assert.isTrue(await internalCopy().inProgress());

      // Wait for the spinner to disappear.
      await waitForNotPresent(transferSpinner);

      // Transfer button should also disappear
      await waitForNotPresent(startTransferButton);

      // And all messages should be gone.
      assert.lengthOf(await messages(), 0);

      // Now go back to internal.
      await api.setAttachmentStore('internal');
      await storageType.waitForValue('Internal');
      assert.lengthOf(await messages(), 1);
      assert.isTrue(await externalCopy().isDisplayed());
      assert.isTrue(await externalCopy().isStatic());
      assert.isTrue(await startTransferButton().isDisplayed());
      assert.isFalse(await transferSpinner().isPresent());

      // Start transfer and check components.
      await api.transferAllAttachments();
      await waitForDisplay(transferSpinner);
      assert.isTrue(await externalCopy().inProgress());
      await waitForNotPresent(transferSpinner);
      await waitForNotPresent(startTransferButton);
      assert.lengthOf(await messages(), 0);
    });
  });

});


const storageType = gu.buildSelectComponent('.test-settings-transfer-storage-select');

const messages = () => driver.findAll('.test-settings-transfer-message', e => e.getText());

const copyWrapper = <T extends WebElementPromise>(el: T) => {
  return Object.assign(el, {
    inProgress() {
      return el.matches('.test-settings-transfer-message-in-progress');
    },
    isStatic() {
      return el.matches('.test-settings-transfer-message-static');
    }
  });
};

const internalCopy = () => copyWrapper(driver.find('.test-settings-transfer-still-internal-copy'));

const externalCopy = () => copyWrapper(driver.find('.test-settings-transfer-still-external-copy'));

const noStoresWarning = () => driver.find('.test-settings-transfer-no-stores-warning');

const addRow = async () => {
  await gu.sendKeys(Key.chord(await gu.modKey(), Key.ENTER));
  await gu.waitForServer();
};

const startTransferButton = () => driver.find('.test-settings-transfer-start-button');

const WAIT = true;
const transferSpinner = (wait = false) => wait
  ? driver.findWait('.test-settings-transfer-spinner', 500)
  : driver.find('.test-settings-transfer-spinner');


async function waitForDisplay(fn: () => WebElementPromise) {
  await gu.waitToPass(async () => {
    assert.isTrue(await fn().isDisplayed());
  });
}

async function waitForNotPresent(fn: () => WebElementPromise) {
  await gu.waitToPass(async () => {
    assert.isFalse(await fn().isPresent());
  });
}

const attachmentSection = () => driver.find('.test-admin-panel-item-preferredStorage');
