'use strict';

import * as vscode from 'vscode';
import * as jsYaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';
import * as keyTarType from 'keytar';

import { F5TreeProvider } from './treeViewsProviders/hostsTreeProvider';
import { TclTreeProvider } from './treeViewsProviders/tclTreeProvider';
import { AS3TreeProvider } from './treeViewsProviders/as3TreeProvider';
import { ExampleDecsProvider } from './treeViewsProviders/githubDecExamples';
import { FastTemplatesTreeProvider } from './treeViewsProviders/fastTreeProvider';
import * as f5Api from './utils/f5Api';
import * as extAPI from './utils/externalAPIs';
import * as utils from './utils/utils';
import { ext, git, loadConfig } from './extensionVariables';
import { FastWebViewPanel } from './utils/fastHtmlPreveiwWebview';
import * as f5FastApi from './utils/f5FastApi';
import * as f5FastUtils from './utils/f5FastUtils';
import * as rpmMgmt from './utils/rpmMgmt';
import { MgmtClient } from './utils/f5DeviceClient';
import { chuckJoke1, chuckJoke2 } from './chuckJoke';

import logger from './utils/logger';

import { TextDocumentView } from './editorViews/editorView';

const fast = require('@f5devcentral/f5-fast-core');

export function activate(context: vscode.ExtensionContext) {

	logger.debug('Congratulations, your extension "vscode-f5-fast" is now active!');
	logger.verbose('Congratulations, your extension "vscode-f5-fast" is now active!');

	// assign context to global
	ext.context = context;

	// Create a status bar item
	ext.hostStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 15);
	context.subscriptions.push(ext.hostStatusBar);
	ext.hostNameBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 14);
	context.subscriptions.push(ext.hostNameBar);
	ext.fastBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 13);
	context.subscriptions.push(ext.fastBar);
	ext.as3Bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
	context.subscriptions.push(ext.as3Bar);
	ext.doBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
	context.subscriptions.push(ext.doBar);
	ext.tsBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
	context.subscriptions.push(ext.tsBar);
	

	ext.connectBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
	context.subscriptions.push(ext.connectBar);
	ext.connectBar.command = 'f5.connectDevice';
    ext.connectBar.text = 'F5-FAST -> Connect!';
	ext.connectBar.tooltip = 'Click to connect!';
	ext.connectBar.show();

	// const webview = new HttpResponseWebview(context);
	const panel = new TextDocumentView();


	// ext.logger = new Logger('f5-fast'); 
	// const log = new Logger('f5-fast');
	// log.log('yeeee');
	
	
	ext.keyTar = keyTarType;

	// load ext config to ext.settings.
	loadConfig();

	// keep an eye on this for different user install scenarios, like slim docker containers that don't have the supporting librarys
	// if this error happens, need to find a fallback method of password caching or disable caching without breaking everything
	if (ext.keyTar === undefined) {
		throw new Error('keytar undefined in initiation');
	}



	/**
	 * #########################################################################
	 *
	 * 	     ########  ######## ##     ## ####  ######  ########  ######  
	 *	     ##     ## ##       ##     ##  ##  ##    ## ##       ##    ## 
	 *	     ##     ## ##       ##     ##  ##  ##       ##       ##       
	 *	     ##     ## ######   ##     ##  ##  ##       ######    ######  
	 *	     ##     ## ##        ##   ##   ##  ##       ##             ## 
	 *	     ##     ## ##         ## ##    ##  ##    ## ##       ##    ## 
	 * 	     ########  ########    ###    ####  ######  ########  ######  
	 * 
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Banner3&t=Devices
	 * #########################################################################
	 */
	
	
	const hostsTreeProvider = new F5TreeProvider('');
	vscode.window.registerTreeDataProvider('f5Hosts', hostsTreeProvider);
	vscode.commands.registerCommand('f5.refreshHostsTree', () => hostsTreeProvider.refresh());
	
	context.subscriptions.push(vscode.commands.registerCommand('f5.connectDevice', async (device) => {
		// logger.debug('selected device', device);
		// logger.verbose('selected device', device);
		logger.debug('selected device', device);  // preferred at the moment

		if(ext.mgmtClient) {
			ext.mgmtClient.disconnect();
		}

		type devObj = {
			device: string,
			provider: string
		};
		
		if (!device) {
			const bigipHosts: Array<devObj> | undefined = await vscode.workspace.getConfiguration().get('f5.hosts');

			if (bigipHosts === undefined) {
				throw new Error('no hosts in configuration');
			}

			/**
			 * loop through config array of objects and build quickPick list appropriate labels
			 * [ {label: admin@192.168.1.254:8443, target: { host: 192.168.1.254, user: admin, ...}}, ...]
			 */
			const qPickHostList = bigipHosts.map( item => {
				return { label: item.device, target: item };
			});

			device = await vscode.window.showQuickPick(qPickHostList, {placeHolder: 'Select Device'});
			if (!device) {
				throw new Error('user exited device input');
			} else {
				// now that we made it through quickPick drop the label/object wrapper for list and just return device object
				device = device.target;
			}
		}
		
		// logger.debug('device-connect:', JSON.stringify(device));

		var [user, host] = device.device.split('@');
		var [host, port] = host.split(':');

		const password: string = await utils.getPassword(device.device);

		ext.mgmtClient = new MgmtClient( device.device, {
			host,
			port,
			user,
			provider: device.provider,
			password
		});

		const connect = await ext.mgmtClient.connect();
		logger.debug(`F5 Connect Discovered ${JSON.stringify(connect)}`);
		setTimeout( () => { tclTreeProvider.refresh();}, 300);
	}));
	
	context.subscriptions.push(vscode.commands.registerCommand('f5.getProvider', async () => {
		const resp: any = await ext.mgmtClient?.makeRequest('/mgmt/tm/auth/source');
		panel.render(resp);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.getF5HostInfo', async () => {
		var device: string | undefined = ext.hostStatusBar.text;
		
		if (!device) {
			device = await vscode.commands.executeCommand('f5.connectDevice');
		}
		
		if (device === undefined) {
			throw new Error('no hosts in configuration');
		}

		const resp: any = await ext.mgmtClient?.makeRequest('/mgmt/shared/identified-devices/config/device-info');
		panel.render(resp);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.disconnect', () => {

		if(ext.mgmtClient) {
			ext.mgmtClient.disconnect();
			ext.mgmtClient = undefined;
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.clearPassword', async (item) => {
		return hostsTreeProvider.clearPassword(item?.label);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.addHost', async (newHost) => {
		return await hostsTreeProvider.addDevice(newHost);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.removeHost', async (hostID) => {
		return await hostsTreeProvider.removeDevice(hostID);
	}));
	
	context.subscriptions.push(vscode.commands.registerCommand('f5.editHost', async (hostID) => {
		
		logger.debug(`Edit Host command: ${JSON.stringify(hostID)}`);
		
		let bigipHosts: {device: string} [] | undefined= vscode.workspace.getConfiguration().get('f5.hosts');
		logger.debug(`Current bigipHosts: ${JSON.stringify(bigipHosts)}`);
		
		vscode.window.showInputBox({
			prompt: 'Update Device/BIG-IP/Host', 
			value: hostID.label,
			ignoreFocusOut: true
		})
		.then( input => {

			logger.debug('user input', input);

			if (input === undefined || bigipHosts === undefined) {
				throw new Error('Update device inputBox cancelled');
			}

			const deviceRex = /^[\w-.]+@[\w-.]+(:[0-9]+)?$/;
			const devicesString = JSON.stringify(bigipHosts);
			
			if (!devicesString.includes(`\"${input}\"`) && deviceRex.test(input)) {

				bigipHosts.forEach( (item: { device: string; }) => {
					if(item.device === hostID.label) {
						item.device = input;
					}
				});
				
				vscode.workspace.getConfiguration().update('f5.hosts', bigipHosts, vscode.ConfigurationTarget.Global);
				setTimeout( () => { hostsTreeProvider.refresh();}, 300);
			} else {
		
				vscode.window.showErrorMessage('Already exists or invalid format: <user>@<host/ip>:<port>');
			}
		});
		
	}));



	context.subscriptions.push(vscode.commands.registerCommand('f5.editDeviceProvider', async (hostID) => {
		
		let bigipHosts: {device: string} [] | undefined= vscode.workspace.getConfiguration().get('f5.hosts');

		const providerOptions: string[] = [
			'local',
			'radius',
			'tacacs',
			'tmos',
			'active-dirctory',
			'ldap',
			'apm',
			'custom for bigiq'
		];

		vscode.window.showQuickPick(providerOptions, {placeHolder: 'Default BIGIP providers'})
		.then( async input => {

			logger.debug('user input', input);

			if (input === undefined || bigipHosts === undefined) {
				throw new Error('Update device inputBox cancelled');
			}

			if (input === 'custom for bigiq') {
				input = await vscode.window.showInputBox({
					prompt: "Input custom bigiq login provider"
				});
			}

			bigipHosts.forEach( (item: { device: string; provider?: string; }) => {
				if(item.device === hostID.label) {
					item.provider = input;
				}
			});
			
			vscode.workspace.getConfiguration().update('f5.hosts', bigipHosts, vscode.ConfigurationTarget.Global);

			setTimeout( () => { hostsTreeProvider.refresh();}, 300);
		});
		
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.openSettings', () => {
		//	open settings window and bring the user to the F5 section
		return vscode.commands.executeCommand("workbench.action.openSettings", "f5");
	}));



	/**
	 * ###########################################################################
	 * 
	 * 				RRRRRR     PPPPPP     MM    MM 
	 * 				RR   RR    PP   PP    MMM  MMM 
	 * 				RRRRRR     PPPPPP     MM MM MM 
	 * 				RR  RR     PP         MM    MM 
	 * 				RR   RR    PP         MM    MM 
	 * 
	 * ############################################################################
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=FAST
	 */

	context.subscriptions.push(vscode.commands.registerCommand('f5.installRPM', async (selectedRPM) => {


		if(selectedRPM) {
			// set rpm path/location from oject return in explorer tree
			selectedRPM = selectedRPM.fsPath;
			logger.debug(`workspace selected rpm`, selectedRPM);
		} else {
			// pick atc/tool/version picker/downloader
			selectedRPM = await rpmMgmt.rpmPicker();
			logger.debug('downloaded rpm location', selectedRPM);
		}

		// const iRpms = await rpmMgmt.installedRPMs();
		logger.debug('selected rpm', selectedRPM);
		// logger.debug('installed rpms', JSON.stringify(iRpms));

		if(!selectedRPM) {
			debugger;
			// probably need to setup error handling for this situation
		}
		
		const installedRpm = await rpmMgmt.rpmInstaller(selectedRPM);
		logger.debug('installed rpm', installedRpm);
		ext.mgmtClient?.connect(); // refresh connect/status bars

	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.unInstallRPM', async (rpm) => {
		
		// if no rpm sent in from update command
		if(!rpm) {
			// get installed packages
			const installedRPMs = await rpmMgmt.installedRPMs();
			// have user select package
			rpm = await vscode.window.showQuickPick(installedRPMs, {placeHolder: 'select rpm to remove'});
		} else {
			// rpm came from rpm update call...
		}

		if(!rpm) {	// return error pop-up if quickPick escaped
			return vscode.window.showWarningMessage('user exited - did not select rpm to un-install');
		}

		const status = await rpmMgmt.unInstallRpm(rpm);
		vscode.window.showInformationMessage(`rpm ${rpm} removal ${status}`);
		// debugger;
		
		// used to pause between uninstalling and installing a new version of the same atc
		//		should probably put this somewhere else
		await new Promise(resolve => { setTimeout(resolve, 2000); });
		ext.mgmtClient?.connect(); // refresh connect/status bars

	}));



	/**
	 * ###########################################################################
	 * 
	 * 				TTTTTTT    CCCCC    LL      
  	 * 				  TTT     CC    C   LL      
  	 * 				  TTT     CC        LL      
  	 * 				  TTT     CC    C   LL      
	 * 				  TTT      CCCCC    LLLLLLL 
	 * 
	 * ############################################################################
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=FAST
	 */


	const tclTreeProvider = new TclTreeProvider();
	vscode.window.registerTreeDataProvider('as3Tasks', tclTreeProvider);
	vscode.commands.registerCommand('f5.refreshTclTree', () => tclTreeProvider.refresh());
	

	// --- IRULE COMMANDS ---
	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.getRule', async (rule) => {
		return tclTreeProvider.displayRule(rule);
	}));
	
	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.deleteRule', async (rule) => {
		return tclTreeProvider.deleteRule(rule);
	}));

	
	
	
	
	// --- IAPP COMMANDS ---
	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.getApp', async (item) => {
		logger.debug('f5-tcl.getApp command: ', item);
		return panel.render(item);
	}));

	
	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.getTemplate', async (item) => {
		// returns json view of iApp Template
		return panel.render(item);
	}));
	

	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.getTMPL', async (item) => {
		// gets the original .tmpl output
		const temp = await tclTreeProvider.getTMPL(item);
		tclTreeProvider.displayTMPL(temp);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.iAppRedeploy', async (item) => {
		const temp = await tclTreeProvider.iAppRedeploy(item);
		/**
		 * setup appropriate response
		 * - if no error - nothing
		 * - if error, editor/pop-up to show error
		 */
		// return utils.displayJsonInEditor(item);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.iAppDelete', async (item) => {
		const temp = await tclTreeProvider.iAppDelete(item);
		tclTreeProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.postTMPL', async (item) => {
		const resp: any = await tclTreeProvider.postTMPL(item);
		vscode.window.showInformationMessage(resp);
		return resp;
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.deleteTMPL', async (item) => {
		const resp: any = await tclTreeProvider.deleteTMPL(item);
		return resp;
	}));
	
	context.subscriptions.push(vscode.commands.registerCommand('f5-tcl.mergeTCL', async (item) => {
		await tclTreeProvider.mergeTCL(item);
	}));




	/**
	 * ###########################################################################
	 * 
	 *  			FFFFFFF   AAA    SSSSS  TTTTTTT 
 	 *  			FF       AAAAA  SS        TTT   
 	 *  			FFFF    AA   AA  SSSSS    TTT   
 	 *  			FF      AAAAAAA      SS   TTT   
 	 *  			FF      AA   AA  SSSSS    TTT   
	 * 
	 * ############################################################################
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=FAST
	 */
	
	// setting up hosts tree
	const fastTreeProvider = new FastTemplatesTreeProvider();
	vscode.window.registerTreeDataProvider('fastView', fastTreeProvider);
	vscode.commands.registerCommand('f5-fast.refreshTemplates', () => fastTreeProvider.refresh());

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getInfo', async () => {

		const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/fast/info`);
		panel.render(resp);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.deployApp', async () => {

		// get editor window
		var editor = vscode.window.activeTextEditor;
		if (!editor) {	
			return; // No open text editor
		}

		// capture selected text or all text in editor
		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		// TODO: make this a try sequence to only parse the json once
		let jsonText: object;
		if(utils.isValidJson(text)){
			jsonText = JSON.parse(text);
		} else {
			vscode.window.showWarningMessage(`Not valid json object`);
			return;
		}
		
		const resp = await f5FastApi.deployFastApp(jsonText);

		panel.render(resp);

		// give a little time to finish before refreshing trees
		await new Promise(resolve => { setTimeout(resolve, 3000); });
		fastTreeProvider.refresh();
		as3Tree.refresh();
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getApp', async (tenApp) => {

		const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/fast/applications/${tenApp}`);
		panel.render(resp);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getTask', async (taskId) => {

		const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/fast/tasks/${taskId}`);
		panel.render(resp);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getTemplate', async (template) => {

		const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/fast/templates/${template}`);
		panel.render(resp);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getTemplateSets', async (set) => {

		const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/fast/templatesets/${set}`);
		panel.render(resp);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.convJson2Mst', async () => {

		// get editor window
		var editor = vscode.window.activeTextEditor;
		if (!editor) {	return; // No open text editor
		}

		// capture selected text or all text in editor
		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		logger.debug(JSON.stringify(text));

		if(utils.isValidJson(text)){

			//TODO:  parse object and find the level for just ADC,
			//		need to remove all the AS3 details since fast will handle that
			// - if it's an object and it contains "class" key and value should be "Tenant"
			utils.displayMstInEditor(JSON.parse(text));
		} else {
			vscode.window.showWarningMessage(`not valid json object`);
		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.postTemplate', async (sFile) => {

		let text: string | Buffer;

		if(!sFile) {
			// not right click from explorer view, so gather file details

			// get editor window
			var editor = vscode.window.activeTextEditor;
			if (!editor) {	
				return; // No open text editor
			}

			// capture selected text or all text in editor
			if (editor.selection.isEmpty) {
				text = editor.document.getText();	// entire editor/doc window
			} else {
				text = editor.document.getText(editor.selection);	// highlighted text
			} 
		} else {
			// right click from explorer view, so load file contents
			const fileContents = fs.readFileSync(sFile.fsPath);
			// convert from buffer to string
			text = fileContents.toString('utf8');
		}

		await f5FastUtils.zipPostTemplate(text);

		await new Promise(resolve => { setTimeout(resolve, 1000); });
		fastTreeProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.postTemplateSet', async (sPath) => {

		logger.debug('postTemplateSet selection', sPath);
		let wkspPath;
		let selectedFolder;
		
		if(!sPath) {
			// didn't get a path passed in from right click, so we have to gather necessary details

			// get list of open workspaces
			const workspaces = vscode.workspace.workspaceFolders;
			logger.debug('workspaces', workspaces);
			
			// if no open workspace...
			if(!workspaces) {
				// Show message to select workspace
				await vscode.window.showInformationMessage('See top bar to open a workspace with Fast Templates first');
				// pop up to selecte a workspace
				await vscode.window.showWorkspaceFolderPick();
				// return to begining of function to try again
				return vscode.commands.executeCommand('f5-fast.postTemplateSet');
			}
		
			const folder1 = vscode.workspace.workspaceFolders![0]!.uri;
			wkspPath = folder1.fsPath;
			const folder2 = await vscode.workspace.fs.readDirectory(folder1);
		
			// logger.debug('workspace', vscode.workspace);
			logger.debug('workspace name', vscode.workspace.name);
			
			/**
			 * having problems typing the workspaces to a list for quick pick
			 * todo: get the following working
			 */
			// let wkspc;
			// if (workspaces.length > 1) {
			// 	// if more than one workspace open, have user select the workspace
			// 	wkspc = await vscode.window.showQuickPick(workspaces);
			// } else {
			// 	// else select the first workspace
			// 	wkspc = workspaces[0];
			// }
			
			let wFolders = [];
			for (const [name, type] of await vscode.workspace.fs.readDirectory(folder1)) {

				if (type === vscode.FileType.Directory){
					logger.debug('---directory', name);
					wFolders.push(name);
				}
			};

			// have user select first level folder in workspace
			selectedFolder = await vscode.window.showQuickPick(wFolders);
			
			if(!selectedFolder) {
				// if user "escaped" folder selection window
				return vscode.window.showInformationMessage('Must select a Fast Template Set folder');
			}
			logger.debug('workspace path', wkspPath);
			logger.debug('workspace folder', selectedFolder);
			selectedFolder = path.join(wkspPath, selectedFolder);

		} else {
			logger.debug('caught selected path');
			selectedFolder = sPath.fsPath;
		}

		await f5FastUtils.zipPostTempSet(selectedFolder);

		await new Promise(resolve => { setTimeout(resolve, 3000); });
		fastTreeProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.deleteFastApp', async (tenApp) => {
		
		// var device: string | undefined = ext.hostStatusBar.text;
		// const password = await utils.getPassword(device);
		const resp = await f5FastApi.delTenApp(tenApp.label);
		panel.render(resp);
	
		// give a little time to finish
		await new Promise(resolve => { setTimeout(resolve, 2000); });
		fastTreeProvider.refresh();
		as3Tree.refresh();
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.deleteFastTempSet', async (tempSet) => {

		const resp = await f5FastApi.delTempSet(tempSet.label);

		vscode.window.showInformationMessage(`Fast Template Set Delete: ${resp.data.message}`);

		// give a little time to finish
		await new Promise(resolve => { setTimeout(resolve, 1000); });
		fastTreeProvider.refresh();
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.renderYmlTemplate', async () => {

		/**
		 * this is working through the f5 fast template creating process
		 * https://clouddocs.f5.com/products/extensions/f5-appsvcs-templates/latest/userguide/template-authoring.html
		 * 
		 * I think I was trying to take in a params.yml file to feed into an .mst file to test the output before
		 * 		being able to upload to fast as a template
		 */

		var editor = vscode.window.activeTextEditor;
		if (!editor) {	return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		// const templateEngine = await fast.Template.loadYaml(text);

		// const schema = templateEngine.getParametersSchema();
		// // const view = {};
		// const htmlData = fast.guiUtils.generateHtmlPreview(schema, {});
		// displayWebView(htmlData);
		// f5FastUtils.templateFromYaml(text);

	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.renderHtmlPreview', async () => {

		/**
		 * this view is requested by zinke as part of the template authoring process
		 * 	The view should consume/watch the yml file that defines the user inputs for the template
		 * 	Every time a save occurs, it should refresh with the changes to streamline the authoring process
		 */

		var editor = vscode.window.activeTextEditor;
		if (!editor) {	return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		const templateEngine = await fast.Template.loadYaml(text);

		const schema = templateEngine.getParametersSchema();

		const htmlData = fast.guiUtils.generateHtmlPreview(schema, {});
		FastWebViewPanel.render(context.extensionPath, htmlData);
		// f5FastUtils.renderHtmlPreview(text);

	}));





	
	
	/**
	 * ############################################################################
	 * 
	 * 				  AAA     SSSSS   333333  
	 * 				 AAAAA   SS          3333 
	 * 				AA   AA   SSSSS     3333  
	 * 				AAAAAAA       SS      333 
	 * 				AA   AA   SSSSS   333333  
	 * 
	 * ############################################################################
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=AS3
	 */

	
	// setting up as3 tree
	const as3Tree = new AS3TreeProvider();
	vscode.window.registerTreeDataProvider('as3Tenants', as3Tree);
	vscode.commands.registerCommand('f5-as3.refreshTenantsTree', () => as3Tree.refresh());
	
	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.getDecs', async (tenant) => {

		// set blank value if not defined -> get all tenants dec
		tenant = tenant ? tenant : '';

		const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/appsvcs/declare/${tenant}`);
		panel.render(resp);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.fullTenant', async (tenant) => {
		vscode.commands.executeCommand('f5-as3.getDecs', `${tenant.label}?show=full`);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.expandedTenant', async (tenant) => {
		vscode.commands.executeCommand('f5-as3.getDecs', `${tenant.label}?show=expanded`);
	}));
	
	
	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.deleteTenant', async (tenant) => {
		
	    const progress = await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Deleting ${tenant.label} Tenant`
		}, async (progress) => {
			
			const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/appsvcs/declare/${tenant.label}`, {
				method: 'DELETE'
			});
			const resp2 = resp.data.results[0];
			progress.report({message: `${resp2.code} - ${resp2.message}`});
			// hold the status box for user and let things finish before refresh
			await new Promise(resolve => { setTimeout(resolve, 5000); });
		});

		as3Tree.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.getTask', (id) => {

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting AS3 Task`
		}, async () => {

			const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/appsvcs/task/${id}`);
			panel.render(resp);
		});

	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.postDec', async () => {

		ext.as3AsyncPost = vscode.workspace.getConfiguration().get('f5.as3Post.async');

		let postParam;
		if(ext.as3AsyncPost) {
			postParam = 'async=true';
		} else {
			postParam = undefined;
		}

		var editor = vscode.window.activeTextEditor;
		if (!editor) {
			return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		if (!utils.isValidJson(text)) {
			return vscode.window.showErrorMessage('Not valid JSON object');
		}

		const resp = await f5Api.postAS3Dec(postParam, JSON.parse(text));
		panel.render(resp);
		as3Tree.refresh();
	}));


	/**
	 * experimental - this feature is intented to grab the current json object declaration in the editor,
	 * 		try to figure out if it's as3/do/ts, then apply the appropriate schema reference in the object
	 * 	if it detects the schema already there, it will remove it.
	 */
	context.subscriptions.push(vscode.commands.registerCommand('f5.injectSchemaRef', async () => {

		vscode.window.showWarningMessage('experimental feature in development');
		
		var editor = vscode.window.activeTextEditor;
		if (!editor) {
			return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		if (!utils.isValidJson(text)) {
			return vscode.window.showErrorMessage('Not valid JSON object');
		}
		
		var newText = JSON.parse(text);
		if(!newText.hasOwnProperty('$schema')) {
			//if it has the class property, see what it is
			if(newText.hasOwnProperty('class') && newText.class === 'AS3') {
				newText['$schema'] = git.latestAS3schema;

			} else if (newText.hasOwnProperty('class') && newText.class === 'Device') {
				newText['$schema'] = git.latestDOschema;
				
			} else if (newText.hasOwnProperty('class') && newText.class === 'Telemetry') {
				newText['$schema'] = git.latestTSschema;
			} else {
				vscode.window.showInformationMessage(`Could not find base declaration class for as3/do/ts`);
			}
		} else {
			vscode.window.showInformationMessage(`Removing ${newText.$schema}`);
			delete newText.$schema;

		}

		logger.debug(`newText below`);
		logger.debug(newText);

		const {activeTextEditor} = vscode.window;

        if (activeTextEditor && activeTextEditor.document.languageId === 'json') {
            const {document} = activeTextEditor;
			const firstLine = document.lineAt(0);
			const lastLine = document.lineAt(document.lineCount - 1);
			var textRange = new vscode.Range(0,
			firstLine.range.start.character,
			document.lineCount - 1,
			lastLine.range.end.character);
			editor.edit( edit => {
				edit.replace(textRange, newText);
			});
            // if (firstLine.text !== '42') {
            //     const edit = new vscode.WorkspaceEdit();
            //     edit.insert(document.uri, firstLine.range.start, '42\n');
            //     return vscode.workspace.applyEdit(edit)
            // }
        }
		// const { activeTextEditor } = vscode.window;
		// const { document } = activeTextEditor;

		// const fullText = document.getText();
		// const fullRange = new vscode.Range(
		// 	document.positionAt(0),
		// 	document.positionAt(fullText.length - 1)
		// )

		// let invalidRange = new Range(0, 0, textDocument.lineCount /*intentionally missing the '-1' */, 0);
		// let fullRange = textDocument.validateRange(invalidRange);
		// editor.edit(edit => edit.replace(fullRange, newText));
		
		// editor.edit(edit => {
		// 	const startPosition = new Position(0, 0);
		// 	const endPosition = vscode.TextDocument.lineAt(document.lineCount - 1).range.end;
		// 	edit.replace(new Range(startPosition, endPosition), newText);
		// });

		// var firstLine = textEdit.document.lineAt(0);
		// var lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
		// var textRange = new vscode.Range(0,
		// firstLine.range.start.character,
		// textEditor.document.lineCount - 1,
		// lastLine.range.end.character);

		// textEditor.edit(function (editBuilder) {
		// 	editBuilder.replace(textRange, '$1');
		// });


		// editor.edit(builder => builder.replace(textRange, newText));
		// });

	}));







	/**
	 * #########################################################################
	 * 
	 *			 TTTTTTT  SSSSS  	
	 *			   TTT   SS      	
	 *			   TTT    SSSSS  	
	 *			   TTT        SS 	
	 *			   TTT    SSSSS  	
	 * 	
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=TS
	 * http://patorjk.com/software/taag/#p=display&h=0&f=ANSI%20Regular&t=TS
	 * #########################################################################
	 * 
	 */




	context.subscriptions.push(vscode.commands.registerCommand('f5-ts.info', async () => {
		const resp: any = await ext.mgmtClient?.makeRequest('/mgmt/shared/telemetry/info');
		panel.render(resp);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-ts.getDec', async () => {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting TS Dec`
		}, async () => {
			const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/telemetry/declare`);
			panel.render(resp);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-ts.postDec', async () => {
		
		// if selected text, capture that, if not, capture entire document
		var editor = vscode.window.activeTextEditor;
		let text: string;
		if(editor) {
			if (editor.selection.isEmpty) {
				text = editor.document.getText();	// entire editor/doc window
			} else {
				text = editor.document.getText(editor.selection);	// highlighted text
			} 

			if (!utils.isValidJson(text)) {
				return vscode.window.showErrorMessage('Not valid JSON object');
			}
		}

		const progress = await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Posting TS Dec`
		}, async () => {
			const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/telemetry/declare`, {
				method: 'POST',
				body: JSON.parse(text)
			});
			panel.render(resp);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.getGitHubExample', async (decUrl) => {

		const resp = await extAPI.makeRequest({	url: decUrl	});
		return panel.render(resp);
	}));





/**
 * #########################################################################
 * 
 * 			 █████    ██████  
 *			 ██   ██ ██    ██ 
 *			 ██   ██ ██    ██ 
 *			 ██   ██ ██    ██ 
 *			 █████    ██████  
 * 			
 * #########################################################################
 * 	http://patorjk.com/software/taag/#p=display&h=0&f=ANSI%20Regular&t=DO
 */

	context.subscriptions.push(vscode.commands.registerCommand('f5-do.getDec', async () => {

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting DO Dec`
		}, async () => {
			const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/declarative-onboarding/`);
			panel.render(resp);
		});


	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-do.postDec', async () => {

		var editor = vscode.window.activeTextEditor;
		if (!editor) {
			return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		if (!utils.isValidJson(text)) {
			return vscode.window.showErrorMessage('Not valid JSON object');
		}

		const resp = await f5Api.postDoDec(JSON.parse(text));
		panel.render(resp);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-do.inspect', async () => {

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting DO Inspect`
		}, async () => {
			const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/declarative-onboarding/inspect`);
			panel.render(resp);
		}); 

	}));



	context.subscriptions.push(vscode.commands.registerCommand('f5-do.getTasks', async () => {

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting DO Tasks`
		}, async () => {
			const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/shared/declarative-onboarding/task`);
			panel.render(resp);
		});
	}));





/**
 * #########################################################################
 * 
 * 		UU   UU  TTTTTTT  IIIII  LL      
 * 		UU   UU    TTT     III   LL      
 * 		UU   UU    TTT     III   LL      
 * 		UU   UU    TTT     III   LL      
 * 		 UUUUU     TTT    IIIII  LLLLLLL 
 * 
 * #########################################################################
 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=UTIL
 */


	// register example delarations tree
	vscode.window.registerTreeDataProvider('decExamples', new ExampleDecsProvider());


	context.subscriptions.push(vscode.commands.registerCommand('f5.jsonYmlConvert', async () => {
		const editor = vscode.window.activeTextEditor;
		if(!editor) {
			return;
		}
		const selection = editor.selection;	
		const text = editor.document.getText(editor.selection);	// highlighted text

		
		let newText: string;
		if (utils.isValidJson(text)) {
			logger.debug('converting json -> yaml');
			// since it was valid json -> dump it to yaml
			newText = jsYaml.safeDump(JSON.parse(text), {indent: 4});
		} else {
			logger.debug('converting yaml -> json');
			newText = JSON.stringify(jsYaml.safeLoad(text), undefined, 4);
		}

		editor.edit( editBuilder => {
			editBuilder.replace(selection, newText);
		});
	}));

	/**
	 * refactor the json<->yaml/base64-encode/decode stuff to follow the following logic
	 * based off of the vscode-extension-examples document-editing-sample
	 */
	// let disposable = vscode.commands.registerCommand('extension.reverseWord', function () {
	// 	// Get the active text editor
	// 	let editor = vscode.window.activeTextEditor;

	// 	if (editor) {
	// 		let document = editor.document;
	// 		let selection = editor.selection;

	// 		// Get the word within the selection
	// 		let word = document.getText(selection);
	// 		let reversed = word.split('').reverse().join('');
	// 		editor.edit(editBuilder => {
	// 			editBuilder.replace(selection, reversed);
	// 		});
	// 	}
	// });

	context.subscriptions.push(vscode.commands.registerCommand('f5.b64Encode', () => {
		const editor = vscode.window.activeTextEditor;
		if(!editor){
			return;
		}
		const text = editor.document.getText(editor.selection);	// highlighted text
		const encoded = Buffer.from(text).toString('base64');
		editor.edit( editBuilder => {
			editBuilder.replace(editor.selection, encoded);
		});
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.b64Decode', () => {
		const editor = vscode.window.activeTextEditor;
		if(!editor){
			return;
		}
		const text = editor.document.getText(editor.selection);	// highlighted text
		const decoded = Buffer.from(text, 'base64').toString('ascii');
		editor.edit( editBuilder => {
			editBuilder.replace(editor.selection, decoded);
		});
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.makeRequest', async () => {
		/**
		 * make open/raw https call
		 * 
		 */

		logger.debug('executing f5.makeRequest');
		const editor = vscode.window.activeTextEditor;
		let resp;

		if(editor){
			var text: any = editor.document.getText(editor.selection);	// highlighted text

			// see if it's json or yaml or string
			if(utils.isValidJson(text)) {

				logger.debug('JSON detected -> parsing');
				text = JSON.parse(text);

			} else {

				logger.debug('NOT JSON');
				
				if(text.includes('url:')) {
					// if yaml should have url: param
					logger.debug('yaml with url: param -> parsing raw to JSON', JSON.stringify(text));
					text = jsYaml.safeLoad(text);
					
				} else {
					// not yaml
					logger.debug('http with OUT url param -> converting to json');
					// trim line breaks
					text = text.replace(/(\r\n|\n|\r)/gm,"");
					text = { url: text };
				}
			}

			/**
			 * At this point we should have a json object with parameters
			 * 	depending on the parameters, it's an F5 call, or an external call
			 */

			if(text.url.includes('http')) {

				resp = await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Making External API Request`,
					cancellable: true
				}, async (progress, token) => {
					token.onCancellationRequested(() => {
						// this logs but doesn't actually cancel...
						logger.debug("User canceled External API Request");
						return new Error(`User canceled External API Request`);
					});
					
					//external call
					logger.debug('external call -> ', JSON.stringify(text));
					return await extAPI.makeRequest(text);
				});
				
			} else {
				
				resp = await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Making API Request`,
					cancellable: true
				}, async (progress, token) => {
					token.onCancellationRequested(() => {
						// this logs but doesn't actually cancel...
						logger.debug("User canceled API Request");
						return new Error(`User canceled API Request`);
					});

					// f5 device call
					if(!ext.mgmtClient) {
						// connect to f5 if not already connected
						await vscode.commands.executeCommand('f5.connectDevice');
					}
				
					logger.debug('device call -> ', JSON.stringify(text));
					return await ext.mgmtClient?.makeRequest(text.url, {
						method: text.method,
						body: text.body
					});
				});
			}

			if(resp) {
				panel.render(resp);
			}
		}

	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.remoteCommand', async () => {

		const cmd = await vscode.window.showInputBox({ placeHolder: 'Bash Command to Execute?', ignoreFocusOut: true });
		
		if ( cmd === undefined ) {
			// maybe just showInformationMessage and exit instead of error?
			throw new Error('Remote Command inputBox cancelled');
		}

		const resp: any = await ext.mgmtClient?.makeRequest(`/mgmt/tm/util/bash`, {
			method: 'POST',
			body: {
				command: 'run',
				utilCmdArgs: `-c '${cmd}'`
			}
		});

		panel.render(resp.data.commandResult);
	}));	



	context.subscriptions.push(vscode.commands.registerCommand('chuckJoke', async () => {

		const newEditorColumn = ext.settings.previewColumn;
		const window = vscode.window.visibleTextEditors;
		let viewColumn: vscode.ViewColumn | undefined;
		
		window.forEach(el => {
			// const el1 = element;
			if (el.document.fileName === 'chuck-joke.json') {
				// logger.debug('f5-fast.json editor column', el1.viewColumn);
				viewColumn = el.viewColumn;
			}
		});
		
		
		const resp: any = await extAPI.makeRequest({url: 'https://api.chucknorris.io/jokes/random'});
		// let activeColumn = vscode.window.activeTextEditor?.viewColumn;
		
		logger.debug('chuck-joke->resp.data', resp.data);

		const content = JSON.stringify(resp.data, undefined, 4);

		// if vClm has a value assign it, else set column 1
		viewColumn = viewColumn ? viewColumn : newEditorColumn;

		var vDoc: vscode.Uri = vscode.Uri.parse("untitled:" + "chuck-Joke.json");
		vscode.workspace.openTextDocument(vDoc)
		.then((a: vscode.TextDocument) => {
			vscode.window.showTextDocument(a, viewColumn, false).then(e => {
				e.edit(edit => {
					const startPosition = new vscode.Position(0, 0);
					const endPosition = a.lineAt(a.lineCount - 1).range.end;
					edit.replace(new vscode.Range(startPosition, endPosition), content);
				});
			});
		});


		// chuckJoke1();

	}));

}


// this method is called when your extension is deactivated
export function deactivate() {}
