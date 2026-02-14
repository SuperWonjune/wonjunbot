const { EventEmitter } = require('events');

class MockClient extends EventEmitter {
    constructor() {
        super();
        this.user = { id: "bot-id", tag: "Bot#1234" };
        this.channels = {
            cache: new Map(),
            fetch: async (id) => this.channels.cache.get(id)
        };
    }
}

class MockInteraction {
    constructor(commandName, user, guild, member) {
        this.isChatInputCommand = () => true;
        this.commandName = commandName;
        this.user = user;
        this.guild = guild;
        this.member = member;
        this.options = {
            data: {},
            getString: (name) => this.options.data[name]
        };
        this.replied = false;
        this.deferred = false;
        this.responses = [];
    }

    async reply(options) {
        this.replied = true;
        this.responses.push({ type: 'reply', content: options.content, flags: options.flags });
    }

    async deferReply(options) {
        this.deferred = true;
        this.responses.push({ type: 'defer', flags: options.flags });
    }

    async editReply(options) {
        this.responses.push({ type: 'edit', content: options.content });
    }

    async followUp(options) {
        this.responses.push({ type: 'followUp', content: options.content });
    }
}

class MockMessage {
    constructor(content, author, guild, channel, member) {
        this.content = content;
        this.author = author;
        this.guild = guild;
        this.channel = channel;
        this.member = member;
        this.replies = [];
    }

    async reply(content) {
        this.replies.push(content);
        return {
            delete: async () => { }
        };
    }
}

class MockVoiceConnection extends EventEmitter {
    constructor() {
        super();
        this.state = { status: 'ready' };
    }
    subscribe() { }
    destroy() { this.emit('stateChange', this.state, { status: 'destroyed' }); }
}

module.exports = {
    MockClient,
    MockInteraction,
    MockMessage,
    MockVoiceConnection
};
