/**
 * Filters
 * Gold Server - http://gold.psim.us/
 *
 * Manually sets filters for chatting and names.
 * In this, we also handle proxy connections with a blacklist feature.
 * Credits: jd, panpawn
 *
 * @license MIT license
 */
'use strict';

const fs = require('fs');

let adWhitelist = Config.adWhitelist ? Config.adWhitelist : [];
let adRegex = new RegExp("(play.pokemonshowdown.com\\/~~)(?!(" + adWhitelist.join('|') + "))", "g");

let bannedMessages = Config.bannedMessages ? Config.bannedMessages : [];

let watchPhrases = Config.watchPhrases ? Config.watchPhrases : [];
let watchUsers = Config.watchUsers ? Config.watchUsers : [];

let proxyWhitelist = Config.proxyWhitelist || false;

/*********************
 * Chatfilter Magic *
 * ******************/

exports.chatfilter = function (message, user, room, connection, targetUser) {
	user.lastActiveTime = Date.now();
	if (!room && !Users(targetUser)) targetUser = {name: 'unknown user'};

	// watch phrases and watch users
	let watchRoom = Rooms('watchroom') ? Rooms('watchroom') : false;
	if (watchRoom) {
		let watchWords = watchPhrases.filter(phrase => { return ~toId(message).indexOf(phrase); }).length;
		let watchUserslist = watchUsers.filter(name => { return ~user.userid.indexOf(name); }).length;
		if (!user.can('hotpatch') && watchWords >= 1 || watchUserslist >= 1) {
			watchRoom.add('|c|' + user.getIdentity() + '| __(' + (room ? "To " + room.id : "Private message to " + targetUser.name) + ")__ " + message).update();
		}
	}

	// global banned messages
	for (let x in bannedMessages) {
		if (message.toLowerCase().indexOf(bannedMessages[x]) > -1 && bannedMessages[x] !== '' && message.substr(0, 1) !== '/') {
			if (user.locked) return false;
			Punishments.lock(user, Date.now() + 7 * 24 * 60 * 60 * 1000, null, "Said a banned word: " + bannedMessages[x]);
			user.popup('You have been automatically locked for sending a message containing a banned word.');
			Monitor.log('[PornMonitor] ' + user.name + ' __(' + (room ? 'In ' + room.id : 'Private message to ' + targetUser.name) + ')__ was automatically locked (and shadow banned) for trying to say "' + message + '"');
			fs.appendFile('logs/modlog/modlog_staff.txt', '[' + (new Date().toJSON()) + '] (staff) ' + user.name + ' was locked from talking by the Server (' +
			bannedMessages[x] + ') (' + connection.ip + ')\n');
			Gold.pmUpperStaff(user.name + ' has been automatically locked for sending a message containing a banned word' +
			(room ? ". **Room:**" + room.id : " in a private message to " + targetUser.name + ".") + ' **Message:** ' + message, '~Server');
			Users.ShadowBan.addUser(user);
		}
	}

	// advertising
	let pre_matches = (message.match(/psim|psim.us|psim us|psm.us|psm us/g) || []).length;
	let final_check = (pre_matches >= 1 ? adWhitelist.filter(server => { return ~message.indexOf(server); }).length : 0);
	if (!user.can('hotpatch') && (pre_matches >= 1 && final_check === 0 || pre_matches >= 2 && final_check >= 1 || message.match(adRegex))) {
		if (user.locked) return false;
		if (!Users.ShadowBan.checkBanned(user)) {
			Users.ShadowBan.addUser(user);
			fs.appendFile('logs/modlog/modlog_staff.txt', '[' + (new Date().toJSON()) + '] (staff) ' + user.name + ' was shadow banned by the Server. (Advertising) (' + connection.ip + ')\n');
			Gold.pmUpperStaff(user.name + " has been sbanned for attempting to advertise" + (room ? ". **Room:**" + room.id : " in a private message to " + targetUser.name + ".") + " **Message:** " + message, "~Server");
			Monitor.log("[AdvMonitor] " + user.name + " has been sbanned for attempting to advertise" + (room ? ". **Room:** " + room.id : " in a private message to " + targetUser.name + ".") + " **Message:** " + message);
		}
	}
	return message;
};
Config.chatfilter = exports.chatfilter;

/*********************
 * Namefilter Magic *
 * ******************/
try {
	Config.bannedNames = fs.readFileSync('config/bannednames.txt', 'utf8').toLowerCase().split('\n');
} catch (e) {
	Config.bannedNames = [];
}

function loadBannedNames() {
	try {
		Config.bannedNames = fs.readFileSync('config/bannednames.txt', 'utf8').toLowerCase().split('\n');
	} catch (e) {
		Config.bannedNames = [];
	}
}
loadBannedNames();


Config.namefilter = function (name, user) {
	let badNames = Config.bannedNames, badHosts = Object.keys(Gold.lockedHosts), nameId = toId(name);
	for (let x in badNames) {
		if (nameId.indexOf(badNames[x]) > -1 && badNames[x] !== '') {
			Monitor.log('[NameFilter] should probably FR: ' + name);
		}
	}

	// Hostfilter stuff
	let conNum = Object.keys(user.connections).length - 1;
	let ip = user.connections[conNum].ip;
	let trusted = trustedHack(nameId);

	Dnsbl.reverse(ip).then(host => {
		if (!host) return;
		if (badHosts.length < 0) return; // there are no blacklisted hosts (yet)

		// handling "trusted" users...
		if (trusted) return;
		if (Gold.userData[toId(name)] && Gold.userData[toId(name)].proxywhitelist) return;
		if (proxyWhitelist && proxyWhitelist.includes(nameId)) return;

		badHosts.forEach(badHost => {
			if (host.includes(badHost)) {
				user.locked = '#hostfilter';
				user.updateIdentity();
				user.popup("|modal|You have been automatically locked due to being on a proxy known for spam and abuse.\n\nLog off PS! and try reconnecting without a proxy to be unlocked.");
				// Monitor.log("[ProxyMonitor] " + name + " (" + ip + ") has been automatically locked. (" + host + ")");
				return;
			}
		});
	});

	if (user.connections[conNum].headers && user.connections[conNum].headers['user-agent']) {
		user.useragent = user.connections[conNum].headers['user-agent'];
	}

	Gold.evadeMonitor(user, name);

	return name;
};

// deal with global ranked user's manually...
function trustedHack(name) {
	let nameId = toId(name);
	let userSymbol = (Users.usergroups[nameId] ? Users.usergroups[nameId].substr(0, 1) : ' ');
	let rankIndex = (Config.groupsranking.includes(userSymbol) ? Config.groupsranking.indexOf(userSymbol) : false);
	if (rankIndex && rankIndex > 0) return true;
	return false;
}

/*********************
 * Hostfilter Magic *
 * ******************/
Gold.lockedHosts = Object.create(null);

function loadHostBlacklist() {
	fs.readFile('config/lockedhosts.json', 'utf8', function (err, file) {
		if (err) return;
		Gold.lockedHosts = JSON.parse(file);
	});
}
loadHostBlacklist();

function saveHost() {
	fs.writeFileSync('config/lockedhosts.json', JSON.stringify(Gold.lockedHosts));
}


Gold.evadeMonitor = function (user, name, punished) {
	let punishments = this.punishments;
	if (punished && punished.alts) {
		punished.alts.forEach(alt => {
			if (Gold.punishments[toId(alt)]) delete Gold.punishments[toId(alt)];
		});
		Gold.savePunishments();
		return;
	}
	let points = 0;
	let num = Object.keys(user.connections).length - 1;
	let userAgent = user.useragent ? user.useragent : '';
	let ip = user.connections[num].ip;

	if (punished) {
		punishments[user.userid] = {
			'useragent': userAgent,
			'ip': ip,
			'iprange': Gold.getIpRange(ip)[0],
			'ipclass': Gold.getIpRange(ip)[1],
			'type': punished.type,
			'exires': punished.expires,
		};
		Gold.savePunishments();
	} else {
		if (user.locked || Users.ShadowBan.checkBanned(user) || trustedHack(name)) return;

		let ipRange = Gold.getIpRange(ip)[0];
		let reasons = [];
		let evader = '';
		let alertStaff = false;
		let defaultAvatars = [1, 2, 101, 102, 169, 170, 265, 266];
		Object.keys(punishments).forEach(offender => {
			if (punishments[offender].exires < Date.now()) return;
			if (punishments[offender].useragent === userAgent) {
				points++;
				reasons.push(`have the same user agent`);
				evader = punishments[offender].type + ' user: ' + offender;
				alertStaff = true;
			}
			if (punishments[offender].iprange && ip.startsWith(punishments[offender].iprange)) {
				points++;
				reasons.push(`have the IPv4 class ${punishments[offender].ipclass} range (${ipRange}.*)`);
				evader = punishments[offender].type + ' user: ' + offender;
			}
			// this does not count AS a reason, but merely to add to the list of reasons
			if (defaultAvatars.includes(user.avatar)) {
				reasons.push(`have a default avatar`);
			}
		});
		let staff = Rooms('staff');
		if (points >= 2) {
			Users.ShadowBan.addUser(name);
			if (staff) staff.add(`[EvadeMonitor] SHADOWBANNED: ${name}, evading alt of ${evader} because they ${reasons.join(' and ')}`).update();
		} else if (alertStaff) {
			if (staff) staff.add(`[EvadeMonitor] SUSPECTED EVADER: ${name} is possibly an evading alt of ${evader} because they ${reasons.join(' and ')}.`).update();
		}
	}
};

exports.commands = {
	lockhost: function (target, room, user) {
		if (!this.can('pban')) return false;
		if (!target) return this.parse('/help lockhost');
		if (Gold.lockedHosts[target]) return this.errorReply("The host '" + target + "' is was already locked by " + Gold.lockedHosts[target].by + ".");

		Gold.lockedHosts[target] = {
			by: user.name,
			on: Date.now(),
		};
		saveHost();

		this.privateModCommand("(" + user.name + " has blacklisted host: " + target + ")");
	},
	lockhosthelp: ["/lockhost [host] - Adds host to server blacklist.  Users connecting with these hosts will be automatically locked from connection, so use this carefully! Requires & ~"],

	unlockhost: function (target, room, user) {
		if (!this.can('pban')) return false;
		if (!target) return this.parse('/help unlockhost');
		if (!Gold.lockedHosts[target]) return this.errorReply("The host '" + target + "' is not currently blacklisted.");

		delete Gold.lockedHosts[target];
		saveHost();

		this.privateModCommand("(" + user.name + " has unblacklisted host: " + target + ")");
	},
	unlockhosthelp: ["/unlockhost [host] - Removes a host from the server's blacklist.  Requires & ~"],

	proxylist: function (target, room, user) {
		if (!this.can('pban')) return false;
		let badHosts = Object.keys(Gold.lockedHosts);
		if (badHosts.length < 0) return this.errorReply("Weird, no proxies have been blacklisted (yet).");

		let buff = '<table border="1" cellspacing ="0" cellpadding="3"><tr><td><b>Proxy:</b></td><td><b>Blacklisted By:</b></td><td><b>Blacklisted:</b></td></tr>';
		badHosts.forEach(proxy => {
			buff += '<tr><td>' + proxy + '</td><td>' + Gold.nameColor(Gold.lockedHosts[proxy].by, false) + '</td><td>' + Chat.toDurationString(Date.now() - Gold.lockedHosts[proxy].on) + ' ago</td></tr>';
		});
		buff += '</table>';

		return this.sendReplyBox(buff);
	},
};
