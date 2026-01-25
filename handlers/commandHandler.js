const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const config = require("../config/config");
const { voiceProfiles, setVoiceProfile } = require("../config/voiceProfiles");

class CommandHandler {
    constructor(client) {
        this.client = client;
        // this.musicService = musicService;
        this.commands = [];

        this._defineCommands();
    }

    _defineCommands() {
        // /voice command
        const voiceChoices = voiceProfiles.map((p, index) => ({
            name: p.name,
            value: index.toString()
        }));

        const voiceCommand = new SlashCommandBuilder()
            .setName("voice")
            .setDescription("TTS 목소리를 변경합니다.")
            .addStringOption(option =>
                option.setName("profile")
                    .setDescription("변경할 목소리를 선택하세요")
                    .setRequired(true)
                    .addChoices(...voiceChoices));

        this.commands = [voiceCommand.toJSON()];
    }

    /**
     * Register commands to Discord
     */
    async registerCommands() {
        const rest = new REST({ version: "10" }).setToken(config.TOKEN);

        try {
            console.log("[Command] Slash Command 등록 시작...");

            // Register global commands
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: this.commands },
            );

            console.log("[Command] Slash Command 등록 완료!");
        } catch (error) {
            console.error("[Command] Command 등록 실패:", error);
        }
    }

    /**
     * Handle Interaction
     */
    async handleInteraction(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const { commandName } = interaction;

        try {
            if (commandName === "voice") {
                const indexStr = interaction.options.getString("profile");
                const index = parseInt(indexStr, 10);

                try {
                    setVoiceProfile(interaction.user.id, index);
                    const profile = voiceProfiles[index];
                    await interaction.reply({
                        content: `✅ 목소리가 **${profile.name}**으로 변경되었습니다.`,
                        ephemeral: true
                    });
                } catch (err) {
                    await interaction.reply({ content: `❌ 오류가 발생했습니다: ${err.message}`, ephemeral: true });
                }
            } else if (commandName === "play") {
                interaction.reply({ content: "Music feature is disabled.", ephemeral: true });
            } else if (commandName === "stop") {
                interaction.reply({ content: "Music feature is disabled.", ephemeral: true });
            }
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
    }
}

module.exports = CommandHandler;
