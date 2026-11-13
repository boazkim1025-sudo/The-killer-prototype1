(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const MAX_PLAYERS = 20;

  let peer = null;
  let connection = null;
  let isHost = false;
  let myId = null;
  let myName = "";
  let roomCode = "";

  let players = [];
  let game = null;

  let publicChatMessages = [];
  let mafiaChatMessages = [];

  const ROLES = [
    {id:"doctor",name:"의사",team:"citizen",desc:"밤에 한 명을 치료합니다."},
    {id:"reporter",name:"기자",team:"citizen",desc:"한 명의 직업을 공개합니다."},
    {id:"police",name:"경찰",team:"citizen",desc:"대상의 밤 행동을 차단합니다."},
    {id:"detective",name:"탐정",team:"citizen",desc:"한 명의 직업을 조사합니다."},
    {id:"medium",name:"영매",team:"citizen",desc:"탈락자의 직업을 확인합니다."},
    {id:"politician",name:"정치인",team:"citizen",desc:"투표에서 두 표를 행사합니다."},
    {id:"soldier",name:"군인",team:"citizen",desc:"공격을 한 번 막습니다."},
    {id:"watcher",name:"감시자",team:"citizen",desc:"대상을 관찰합니다."},
    {id:"trapper",name:"트래퍼",team:"citizen",desc:"대상을 보호합니다."},
    {id:"guardian",name:"수호천사",team:"citizen",desc:"대상을 공격으로부터 보호합니다."},
    {id:"psychologist",name:"정신병자",team:"citizen",desc:"가짜 시민 직업을 받습니다."},
    {id:"timeTraveler",name:"시간 여행자",team:"citizen",desc:"특수 능력은 추후 구현 예정입니다."},

    {id:"boss",name:"보스",team:"mafia",desc:"마피아 팀입니다. 밤에 공격 대상을 선택합니다."},
    {id:"spy",name:"스파이",team:"mafia",desc:"마피아 팀입니다. 밤에 공격 대상을 선택합니다."},
    {id:"intimidator",name:"협박범",team:"mafia",desc:"마피아 팀입니다. 밤에 공격 대상을 선택합니다."},
    {id:"disguiser",name:"변장술사",team:"mafia",desc:"마피아 팀입니다. 밤에 공격 대상을 선택합니다."},
    {id:"controller",name:"조종자",team:"mafia",desc:"마피아 팀입니다. 밤에 공격 대상을 선택합니다."},
    {id:"doppelganger",name:"도플갱어",team:"mafia",desc:"마피아 팀입니다. 밤에 공격 대상을 선택합니다."},
    {id:"necromancer",name:"사령술사",team:"mafia",desc:"마피아 팀입니다. 밤에 공격 대상을 선택합니다."},
    {id:"ghostMafia",name:"유령마피아",team:"mafia",desc:"마피아 팀입니다. 밤에 공격 대상을 선택합니다."},

    {id:"clown",name:"광대",team:"neutral",desc:"투표로 처형되면 승리합니다."},
    {id:"immortal",name:"불사신",team:"neutral",desc:"일반 밤 공격에 면역입니다."},
    {id:"mirror",name:"거울인간",team:"neutral",desc:"특수 능력은 추후 구현 예정입니다."},
    {id:"trickster",name:"사기꾼",team:"neutral",desc:"특수 능력은 추후 구현 예정입니다."},
    {id:"psycho",name:"싸이코패스",team:"neutral",desc:"밤에 한 명을 공격할 수 있습니다."}
  ];

  const TEAM_NAME = {
    citizen: "시민 팀",
    mafia: "마피아 팀",
    neutral: "중립"
  };

  let selectedRoles = new Set(ROLES.map(r => r.id));

  // -------------------------
  // 공통 도구
  // -------------------------

  function notify(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");

    setTimeout(() => toast.classList.remove("show"), 2500);
  }

  function setStatus(message) {
    $("connectionStatus").textContent = message;
  }

  function validateName(value) {
    const name = String(value || "").trim();

    if (name.length < 2 || name.length > 12) {
      notify("닉네임은 2~12자로 입력하세요.");
      return null;
    }

    if (/[<>]/.test(name)) {
      notify("사용할 수 없는 문자가 있습니다.");
      return null;
    }

    return name;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#39;"
    })[c]);
  }

  function randomCode() {
    return Math.random().toString(36)
      .substring(2, 8).toUpperCase();
  }

  function shuffle(array) {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  function roleOf(player) {
    return ROLES.find(r => r.id === player?.role);
  }

  function myPlayer() {
    return players.find(p => p.id === myId);
  }

  function myRoleId() {
    return game?.myRole?.id || myPlayer()?.role;
  }

  function myTeam() {
    return roleOf({role:myRoleId()})?.team || null;
  }

  function showGame() {
    $("setup").classList.add("hidden");
    $("game").classList.remove("hidden");
  }

  function showSetup() {
    $("setup").classList.remove("hidden");
    $("game").classList.add("hidden");
  }

  function send(type, data = {}) {
    const packet = {type, ...data};

    if (isHost) {
      hostReceive(myId, packet);
    } else if (connection?.open) {
      connection.send(packet);
    } else {
      notify("방과 연결되어 있지 않습니다.");
    }
  }

  function sendTo(playerId, packet) {
    if (playerId === myId) {
      if (packet.type === "notice") notify(packet.message);
      return;
    }

    const conn = peer?.connections[playerId]?.[0];

    if (conn?.open) conn.send(packet);
  }

  // -------------------------
  // 방 만들기
  // -------------------------

  function createRoom() {
    const name = validateName($("hostName").value);
    if (!name) return;

    if (typeof Peer === "undefined") {
      notify("PeerJS를 불러오지 못했습니다.");
      return;
    }

    myName = name;
    isHost = true;
    roomCode = randomCode();

    setStatus("방 생성 중...");

    peer = new Peer(roomCode);

    peer.on("open", id => {
      myId = id;

      players = [{
        id,
        name: myName,
        host: true,
        alive: true,
        muted: false,
        coins: 3,
        shield: false,
        used: {}
      }];

      openLobby();
      setStatus("방 생성 완료");
    });

    peer.on("connection", conn => {
      conn.on("data", data => hostReceive(conn.peer, data));

      conn.on("close", () => {
        if (game) return;

        players = players.filter(p => p.id !== conn.peer);
        broadcastLobby();
      });
    });

    peer.on("error", error => {
      notify("방 생성 오류: " + error.type);
      setStatus("연결 오류");
    });
  }

  // -------------------------
  // 방 참가
  // -------------------------

  function joinRoom() {
    const name = validateName($("joinName").value);
    if (!name) return;

    const code = $("roomCode").value.trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(code)) {
      notify("방 코드는 6자리여야 합니다.");
      return;
    }

    if (typeof Peer === "undefined") {
      notify("PeerJS를 불러오지 못했습니다.");
      return;
    }
