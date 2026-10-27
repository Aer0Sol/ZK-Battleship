pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template RowHash() {
    signal input  cells[10];
    signal output hash;

    component p = Poseidon(10);
    for (var i = 0; i < 10; i++) p.inputs[i] <== cells[i];
    hash <== p.out;
}

template ShotVerifier() {
    signal input board[100];
    signal input salt;
    signal input commitment;
    signal input shot_row;
    signal input shot_col;
    signal input is_hit;

    for (var i = 0; i < 100; i++) board[i] * (1 - board[i]) === 0;

    signal fleet[101];
    fleet[0] <== 0;
    for (var i = 0; i < 100; i++) fleet[i+1] <== fleet[i] + board[i];
    fleet[100] === 17;

    component rh[10];
    for (var r = 0; r < 10; r++) {
        rh[r] = RowHash();
        for (var c = 0; c < 10; c++) rh[r].cells[c] <== board[r * 10 + c];
    }
    component root = Poseidon(11);
    for (var r = 0; r < 10; r++) root.inputs[r] <== rh[r].hash;
    root.inputs[10] <== salt;
    commitment === root.out;

    signal index <== shot_row * 10 + shot_col;
    component eq[100];
    signal masked[100];
    signal sel[101];
    sel[0] <== 0;
    for (var i = 0; i < 100; i++) {
        eq[i] = IsEqual();
        eq[i].in[0] <== index;
        eq[i].in[1] <== i;
        masked[i]   <== board[i] * eq[i].out;
        sel[i+1]    <== sel[i] + masked[i];
    }
    sel[100] === is_hit;
}

component main { public [commitment, shot_row, shot_col, is_hit] } = ShotVerifier();
