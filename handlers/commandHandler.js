const { REST, Routes, SlashCommandBuilder, MessageFlags } = require("discord.js");
const config = require("../config/config");
const { voiceProfiles, setVoiceProfile } = require("../config/voiceProfiles");

class CommandHandler {
    constructor(client, ttsService) {
        this.client = client;
        this.ttsService = ttsService;
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

        const ttsStartCommand = new SlashCommandBuilder()
            .setName("ttsstart")
            .setDescription("TTS 봇을 현재 음성 채널로 부릅니다.");

        const ttsStopCommand = new SlashCommandBuilder()
            .setName("ttsstop")
            .setDescription("TTS 봇을 음성 채널에서 내보냅니다.");

        this.commands = [voiceCommand.toJSON(), ttsStartCommand.toJSON(), ttsStopCommand.toJSON()];
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
                        flags: MessageFlags.Ephemeral
                    });
                } catch (err) {
                    await interaction.reply({ content: `❌ 오류가 발생했습니다: ${err.message}`, flags: MessageFlags.Ephemeral });
                }
            } else if (commandName === "ttsstart") {
                const voiceChannel = interaction.member.voice.channel;
                if (!voiceChannel) {
                    await interaction.reply({ content: "❌ 음성 채널에 먼저 접속해주세요.", ephemeral: true });
                    return;
                }

                // 권한 체크 등은 필요하다면 여기에 추가

                try {
                    // 연결에 시간이 걸릴 수 있으므로 defer 처리
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                    await this.ttsService.start(interaction.guild, voiceChannel);
                    await interaction.editReply({ content: `✅ **${voiceChannel.name}** 채널에서 TTS를 시작합니다!` });
                } catch (error) {
                    // 이미 deferred 상태이므로 editReply 사용
                    if (interaction.deferred) {
                        await interaction.editReply({ content: `❌ 시작 실패: ${error.message}` });
                    } else {
                        await interaction.reply({ content: `❌ 시작 실패: ${error.message}`, flags: MessageFlags.Ephemeral });
                    }
                }

            } else if (commandName === "ttsstop") {
                if (!this.ttsService.isActive) {
                    await interaction.reply({ content: "❌ TTS가 현재 실행 중이 아닙니다.", flags: MessageFlags.Ephemeral });
                    return;
                }

                this.ttsService.stop();
                await interaction.reply({ content: "✅ TTS 서비스를 종료하고 퇴장합니다.", flags: MessageFlags.Ephemeral });

            } else if (commandName === "play") {
                interaction.reply({ content: "Music feature is disabled.", flags: MessageFlags.Ephemeral });
            } else if (commandName === "stop") {
                interaction.reply({ content: "Music feature is disabled.", flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
    }
}

module.exports = CommandHandler;
