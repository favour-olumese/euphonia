/**
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {AdminData} from './admindata';
import {UsersView} from './users';
import {Spinner, toast} from '../util';
import {Dialog, ChoiceDialog} from '../dialog';
import {EUserInfo, EUserTaskInfo, ERecordingMetadata} from '../../commonsrc/schema';
import {formatTimestamp, parseTags} from '../../commonsrc/util';
import {BulkAssignDialog} from './tasksets';
import * as schema from '../../commonsrc/schema';

export class UserDetailView {
  data: AdminData;
  parent: UsersView;
  user: EUserInfo;

  // Loaded detail data
  tasks?: EUserTaskInfo[];  // set on first load
  recordings?: ERecordingMetadata[];  // set on first load

  // GUI elements
  div: JQuery<HTMLElement>;
  userinfo: JQuery<HTMLElement>;
  workTable: JQuery<HTMLElement>;

  constructor(parent: UsersView, user: EUserInfo) {
    this.data = parent.app.data;
    this.parent = parent;
    this.user = user;

    this.div = parent.app.main.eadd('<div id=userdetailview />');
    this.userinfo = this.div.eadd('<div class=userinfo />');
    this.div.eadd('<h2 />').etext('Assigned Tasks');
    this.workTable = this.div.eadd('<table class=userwork />');

    this.fillUserInfo_();
  }

  // Fills in the user details
  fillUserInfo_() {
    this.userinfo.empty();
    this.userinfo.eadd('<div class=euid />').etext(`User ${this.user.euid}`);
    const table = this.userinfo.eadd('<table />');
    table.eaddtr([$('<span class=label />').etext('Name:'), $('<span />').etext(`${this.user.name}`)]);
    table.eaddtr([$('<span class=label />').etext('Email:'), $('<span />').etext(`${this.user.email}`)]);
    table.eaddtr([$('<span class=label />').etext('Language:'), $('<span />').etext(`${this.user.language}`)]);
    table.eaddtr([$('<span class=label />').etext('Tags:'), $('<span />').etext(`${this.user.tags.join(' ')}`)]);
    table.eaddtr([$('<span class=label />').etext('Signed up:'), $('<span />').etext(`${formatTimestamp(this.user.signupTimestamp, 'never')}`)]);
    table.eaddtr([$('<span class=label />').etext('Last recorded:'), $('<span />').etext(`${formatTimestamp(this.user.lastRecordingTimestamp)}`)]);
    const [, consentNode] = table.eaddtr([$('<span class=label />').etext('Consents:'), $('<div class=consent />')]);

    // Add consent details
    if (this.user.consents.length == 0) {
      consentNode.addClass('noconsent');
      consentNode.text(`No consents`);
    }
    for (let consent of this.user.consents) {
      const revoked = consent.revokeTimestamp ? `, revoked ${consent.revokeTimestamp}` : '';
      const cts = formatTimestamp(consent.consentTimestamp);
      consentNode.eadd('<div class=consent />').text(`${consent.consentId} (${consent.version}): ${cts}${revoked}`);
    }

    // Notes
    table.eaddtr([$('<span class=label />').etext('Notes:'), $('<span />').etext(`${this.user.notes}`)]);
    const buttons = this.userinfo.eadd('<div class=buttonbox />');
    buttons.eadd('<button />').etext('Edit User').on('click', async e => await this.startEdit());
    buttons.eadd('<button />').etext('Assign tasks').on('click', async e => await this.startAssign());
    buttons.eadd('<button />').etext('Unassign all remaining tasks').on('click', async e => await this.unassignAll());
    this.parent.app.setNav(`/user/${this.user.euid}`);
  }

  // Displays the view
  async start() {
    this.parent.div.hide();
    this.div.show();
    await this.onUserTasksChanged();
  }

  // Cleans up this view
  remove() {
    this.div.remove();
    this.parent.div.show();
  }

  // Update the GUI for any changes to the user
  onDataChanged() {
    const user = this.data.users.get(this.user.euid);
    if (user) {
      this.user = user;
    }
    this.fillUserInfo_();
  }

  // Fills in the user's recordings and tasks
  async onUserTasksChanged() {
    await Spinner.waitFor(async () => {
      const recs = new Map<number, ERecordingMetadata>();
      [this.tasks, this.recordings] = await this.parent.app.data.loadUserWork(this.user.euid);
      for (let rec of this.recordings) {
        recs.set(rec.timestamp, rec);
      }

      // Update the GUI with these lists
      this.workTable.html(`<tr><th>Taskset</th><th>Prompt</th><th>Assigned</th><th>Completed</th><th>Recording</th></tr>`);
      for (let task of this.tasks) {
        const rec = recs.get(task.recordedTimestamp);
        const tr = this.workTable.eadd('<tr />');
        tr.eadd('<td class=taskset />').text(task.taskSetId);
        tr.eadd('<td class=prompt />').text(task.task.prompt);
        tr.eadd('<td class=assigned />').text(formatTimestamp(task.assignedTimestamp));
        tr.eadd('<td class=completed />').text(formatTimestamp(task.recordedTimestamp));
        const playerTd = tr.eadd('<td class=player />');
        if (rec) {
          const url = new URL(window.location.origin + `/api/admin/getaudio?euid=${this.user.euid}&name=${rec.name}`);
          playerTd.eadd(`<audio src="${url}" type="audio/x-wav" controls preload="none" />`);
        }
      }
    });
  }

  // Shows the edit user dialog
  async startEdit() {
    await new EditUserDialog(this).start();
  }

  // Confirms that we should unassign all unrecorded tasks, and then do so
  async unassignAll() {
    const confirm = await ChoiceDialog.choose('Unassigning all unrecorded tasks?', 'Unassign', 'Cancel');
    if (confirm != 'Unassign') {
      return;
    }
    const tasks = this.tasks!.filter(task => task.recordedTimestamp == 0);
    if (tasks.length == 0) {
      toast('No unrecorded tasks');
      return;
    }
    await Spinner.waitFor(async () => {
      await this.data.removeTasks(this.user.euid, tasks);
    });
  }

  // Shows the assignment dialog
  async startAssign() {
    await new BulkAssignDialog(this.parent.app, [this.user.euid]).start();
  }
}

// Holder class for defaults
export class UserValues {
  email: string = '';
  name: string = '';
  language: string = '';
  tags: string[] = [];
  notes: string = '';
}

// Abstract base class for new user / edit user dialog
export class UserPropertiesDialog extends Dialog {
  constructor(defaults: UserValues, title: string, button: string) {
    super('edituserdialog');
    this.div.eadd('<div class=title />').text(title);
    this.startForm();
    const nameField = this.addFormField('Name:', '<input type=text name=name />').evalue(defaults.name);
    const emailField = this.addFormField('Email:', '<input type=text name=email />').evalue(defaults.email);
    const languageField = this.addFormField('Language:', '<input type=text name=language />').evalue(defaults.language);
    const tagsField = this.addFormField('Tags:', '<input type=text name=tags />').evalue(defaults.tags.join(' '));
    const notesField = this.addFormField('Notes:', '<textarea name=notes />').evalue(defaults.notes);

    const buttonTd = this.formTable!.eadd('<tr />').eadd('<td colspan=2 class=buttonbox />');
    buttonTd.eadd(`<button>${button}</button>`).on('click', async e => {
      const name = nameField.val() as string;
      const email = emailField.val() as string;
      const lang = languageField.val() as string;
      const notes = notesField.val() as string;
      const tags: string[] = parseTags(tagsField.val() as string);
      if (!name || !email || !lang) {
        toast('Missing required fields');
        return;
      }
      if (!schema.SUPPORTED_LANGUAGES.has(lang)) {
        toast(`Unsupported language: ${lang}`);
        return;
      }

      await Spinner.waitFor(async () => {
        await this.commit(name, email, lang, tags, notes);
        await this.remove();
      });
    });
    buttonTd.eadd('<button>Cancel</button>').on('click', async e => await this.remove());
  }

  async commit(name: string, email: string, lang: string, tags: string[], notes: string): Promise<void> {
    throw new Error('Not implemented');
  }
}

// Edits the current user
class EditUserDialog extends UserPropertiesDialog {
  parent: UserDetailView;

  constructor(parent: UserDetailView) {
    super(parent.user, `Edit User: ${parent.user.euid}`, 'Save');
    this.parent = parent;
  }

  async commit(name: string, email: string, lang: string, tags: string[], notes: string): Promise<void> {
    await this.parent.data.editUser(this.parent.user.euid, name, email, lang, tags, notes);
  }
}
