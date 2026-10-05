// Solidity's built-in globals, written as declarations so that hover and Go to Definition
// have something to show, like TypeScript's lib.d.ts. This file is never compiled.
// Containers whose name starts with `$` hold the members of a built-in type (`addr.balance`, `arr.push`),
// and `$yul` holds the inline assembly built-ins. A trailing `_` marks a name the parser would reject
// (`ether_`, `return_`); the extension drops it.
// Reference: https://docs.soliditylang.org/en/latest/units-and-global-variables.html

/* ----------------------------------- transaction ----------------------------------- */

/// @notice The current call (message).
library msg {
    /// @notice The complete calldata of the current call (`bytes calldata`).
    bytes data;
    /// @notice The immediate caller: an account or a contract. Changes with every external call.
    address sender;
    /// @notice The first four bytes of the calldata: the function selector.
    bytes4 sig;
    /// @notice The wei sent with the call.
    uint256 value;
}

/// @notice The current transaction.
library tx {
    /// @notice The gas price of the transaction.
    uint256 gasprice;
    /// @notice The account that signed the transaction, at the start of the whole call chain.
    /// @dev Do not use it for authorization; use `msg.sender`.
    address origin;
}

/// @notice The current block.
library block {
    /// @notice The block's base fee (EIP-3198, EIP-1559).
    uint256 basefee;
    /// @notice The block's blob base fee (EIP-7516, EIP-4844).
    uint256 blobbasefee;
    /// @notice The current chain id.
    uint256 chainid;
    /// @notice The address of the block's proposer.
    address payable coinbase;
    /// @notice Since Paris an alias of `block.prevrandao`; deprecated.
    uint256 difficulty;
    /// @notice The block's gas limit.
    uint256 gaslimit;
    /// @notice The block number.
    uint256 number;
    /// @notice Randomness from the beacon chain (EIP-4399). Validators can bias it.
    uint256 prevrandao;
    /// @notice The block's timestamp in seconds since the Unix epoch.
    uint256 timestamp;
}

/// @notice Hash of one of the 256 most recent blocks, excluding the current one; zero otherwise.
function blockhash(uint256 blockNumber) view returns (bytes32);

/// @notice Versioned hash of the `index`-th blob of the current transaction (EIP-4844); zero if there is none.
function blobhash(uint256 index) view returns (bytes32);

/// @notice The gas left in the current call.
function gasleft() view returns (uint256);

/* --------------------------------------- ABI --------------------------------------- */

/// @notice ABI encoding and decoding.
library abi {
    /// @notice Decodes ABI-encoded `data` into the types listed in the second argument,
    /// e.g. `abi.decode(data, (uint256, address))`.
    function decode(bytes memory data /* , (T1, T2, ...) */) pure returns (/* T1, T2, ... */);

    /// @notice ABI-encodes the arguments, each padded to 32 bytes.
    function encode(/* ...args */) pure returns (bytes memory);

    /// @notice Packed (non-standard) encoding: no padding, so different inputs can collide.
    /// @dev Avoid hashing it with more than one dynamic-length argument.
    function encodePacked(/* ...args */) pure returns (bytes memory);

    /// @notice The 4-byte `selector` followed by the ABI-encoded arguments.
    function encodeWithSelector(bytes4 selector /* , ...args */) pure returns (bytes memory);

    /// @notice Same as `encodeWithSelector(bytes4(keccak256(bytes(signature))), ...)`.
    function encodeWithSignature(string memory signature /* , ...args */) pure returns (bytes memory);

    /// @notice ABI-encodes a call to `functionPointer` with the arguments in the tuple, type-checked
    /// against the function, e.g. `abi.encodeCall(IERC20.transfer, (to, amount))`.
    function encodeCall(/* functionPointer, (args...) */) pure returns (bytes memory);
}

/* ------------------------------------- errors ------------------------------------- */

/// @notice Reverts when `condition` is false. Use for checking inputs and external results.
function require(bool condition) pure;

/// @notice Reverts with `message` when `condition` is false. Since Solidity 0.8.26 the second
/// argument can also be a custom error, e.g. `require(ok, Unauthorized())`.
function require(bool condition, string memory message) pure;

/// @notice Panics (error 0x01) when `condition` is false. Use only for invariants that should never break.
function assert(bool condition) pure;

/// @notice Aborts execution and reverts all changes. The statement form `revert CustomError(args)`
/// reverts with a custom error.
function revert() pure;

/// @notice Aborts execution and reverts all changes, with `reason` as the error message.
function revert(string memory reason) pure;

/* ---------------------------------- cryptography ---------------------------------- */

/// @notice Keccak-256 hash of `data`.
function keccak256(bytes memory data) pure returns (bytes32);

/// @notice SHA-256 hash of `data`.
function sha256(bytes memory data) pure returns (bytes32);

/// @notice RIPEMD-160 hash of `data`.
function ripemd160(bytes memory data) pure returns (bytes20);

/// @notice The address that signed `hash`, recovered from an ECDSA signature; zero on error.
/// @dev Accepts malleable signatures; prefer a library such as OpenZeppelin's or Solady's ECDSA.
function ecrecover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) pure returns (address);

/* -------------------------------------- maths -------------------------------------- */

/// @notice `(x + y) % k` with the addition at arbitrary precision. Reverts when `k` is zero.
function addmod(uint256 x, uint256 y, uint256 k) pure returns (uint256);

/// @notice `(x * y) % k` with the multiplication at arbitrary precision. Reverts when `k` is zero.
function mulmod(uint256 x, uint256 y, uint256 k) pure returns (uint256);

/* ------------------------------------ contracts ------------------------------------ */

/// @notice Sends all the contract's Ether to `recipient`. Since Cancun (EIP-6780) it only destroys
/// the contract when called in the transaction that created it. Deprecated.
function selfdestruct(address payable recipient);

/* ------------------------------ members of built-in types ------------------------------ */

/// @notice Members of `address` and `address payable` values.
library $address {
    /// @notice The address's balance in wei.
    uint256 balance;
    /// @notice The code at the address; empty for accounts without code.
    bytes code;
    /// @notice The hash of the code at the address.
    bytes32 codehash;

    /// @notice Sends `amount` wei, forwarding 2300 gas; reverts on failure. `address payable` only.
    function transfer(uint256 amount);

    /// @notice Sends `amount` wei, forwarding 2300 gas; returns false on failure. `address payable` only.
    function send(uint256 amount) returns (bool);

    /// @notice Low-level CALL with `data`, forwarding all available gas unless set with `{gas: ...}`.
    /// Send wei with `{value: ...}`. Check the returned `success`.
    function call(bytes memory data) returns (bool success, bytes memory returnData);

    /// @notice Low-level DELEGATECALL: runs the address's code in this contract's context.
    function delegatecall(bytes memory data) returns (bool success, bytes memory returnData);

    /// @notice Low-level STATICCALL: a call that reverts if it modifies state.
    function staticcall(bytes memory data) view returns (bool success, bytes memory returnData);
}

/// @notice Members of arrays and `bytes`.
library $array {
    /// @notice The number of elements.
    uint256 length;

    /// @notice Appends a zero-initialised element and returns a reference to it. Storage arrays and `bytes` only.
    function push() returns (/* T storage */);

    /// @notice Appends `value`. Storage arrays and `bytes` only.
    function push(/* T */ value);

    /// @notice Removes the last element. Storage arrays and `bytes` only.
    function pop();
}

/// @notice Static members of `bytes`.
library $bytes {
    /// @notice Concatenates `bytes` and `bytesN` arguments into one `bytes memory`.
    function concat(/* ...args */) pure returns (bytes memory);
}

/// @notice Static members of `string`.
library $string {
    /// @notice Concatenates `string` arguments into one `string memory`.
    function concat(/* ...args */) pure returns (string memory);
}

/// @notice Members of `type(X)`.
library $type {
    /// @notice The contract's name.
    string name;
    /// @notice The creation bytecode of contract `X`.
    bytes creationCode;
    /// @notice The runtime bytecode of contract `X`.
    bytes runtimeCode;
    /// @notice The EIP-165 interface id of interface `X`.
    bytes4 interfaceId;
    /// @notice The smallest value of integer or enum type `X`.
    uint256 min;
    /// @notice The largest value of integer or enum type `X`.
    uint256 max;
}

/// @notice Members of a function: `this.f.selector`, `IERC20.transfer.selector`.
library $function {
    /// @notice The function's 4-byte selector: the first four bytes of the keccak256 of its signature.
    /// External and public functions only.
    bytes4 selector;
    /// @notice The address of the contract an external function pointer belongs to.
    address address;
}

/// @notice Members of a custom error: `Unauthorized.selector`.
library $error {
    /// @notice The error's 4-byte selector, which starts its revert data.
    bytes4 selector;
}

/// @notice Members of an event: `Transfer.selector` (Solidity 0.8.15+).
library $event {
    /// @notice The keccak256 of the event's signature: its first topic (`topic0`). Zero for anonymous events.
    bytes32 selector;
}

/// @notice Static members of a user-defined value type (`type Price is uint128`).
library $userType {
    /// @notice Converts a value of the underlying type into this type, free of cost.
    function wrap(/* underlying */ value) pure returns (/* T */);
    /// @notice Converts this type back into its underlying type, free of cost.
    function unwrap(/* T */ value) pure returns (/* underlying */);
}

/// @notice Members of fixed-size byte arrays (`bytes1` to `bytes32`).
library $fixedBytes {
    /// @notice The number of bytes, fixed by the type: 32 for `bytes32`.
    uint8 length;
}

/* -------------------------------------- units -------------------------------------- */

/// @notice Ether unit: 1 wei, the smallest. `1 wei == 1`.
uint256 constant wei_ = 1;
/// @notice Ether unit: `1 gwei == 1e9` wei.
uint256 constant gwei_ = 1e9;
/// @notice Ether unit: `1 ether == 1e18` wei.
uint256 constant ether_ = 1e18;
/// @notice Time unit: `1 seconds == 1`.
uint256 constant seconds_ = 1;
/// @notice Time unit: `1 minutes == 60` seconds.
uint256 constant minutes_ = 60;
/// @notice Time unit: `1 hours == 3600` seconds.
uint256 constant hours_ = 3600;
/// @notice Time unit: `1 days == 86400` seconds. Not calendar-aware.
uint256 constant days_ = 86400;
/// @notice Time unit: `1 weeks == 604800` seconds.
uint256 constant weeks_ = 604800;

/* ------------------------------------- assembly ------------------------------------- */

/// @notice Inside `assembly { ... }`, members a Solidity variable exposes.
library $assemblyAccess {
    /// @notice The storage slot of a storage variable or reference.
    uint256 slot;
    /// @notice The byte offset inside the slot (storage), or where the data starts in calldata (calldata arrays).
    uint256 offset;
    /// @notice The number of elements of a calldata array.
    uint256 length;
}

/// @notice Built-in functions available inside `assembly { ... }` (Yul, EVM dialect). Every value is a
/// 256-bit word; `mem[a...b)` is memory from `a` to `b` (exclusive), `storage[k]` the storage slot `k`.
library $yul {
    /// @notice Stops execution, like `return(0, 0)`.
    function stop();

    /// @notice `x + y`, wrapping on overflow.
    function add(uint256 x, uint256 y) returns (uint256 sum);
    /// @notice `x - y`, wrapping on underflow.
    function sub(uint256 x, uint256 y) returns (uint256 difference);
    /// @notice `x * y`, wrapping on overflow.
    function mul(uint256 x, uint256 y) returns (uint256 product);
    /// @notice `x / y` (unsigned), and 0 when `y` is 0.
    function div(uint256 x, uint256 y) returns (uint256 quotient);
    /// @notice `x / y` for two's complement signed numbers, and 0 when `y` is 0.
    function sdiv(uint256 x, uint256 y) returns (uint256 quotient);
    /// @notice `x % y` (unsigned), and 0 when `y` is 0.
    function mod(uint256 x, uint256 y) returns (uint256 remainder);
    /// @notice `x % y` for two's complement signed numbers, and 0 when `y` is 0.
    function smod(uint256 x, uint256 y) returns (uint256 remainder);
    /// @notice `x` to the power of `y`, wrapping.
    function exp(uint256 x, uint256 y) returns (uint256 power);
    /// @notice `(x + y) % m` at arbitrary precision, and 0 when `m` is 0.
    function addmod(uint256 x, uint256 y, uint256 m) returns (uint256 result);
    /// @notice `(x * y) % m` at arbitrary precision, and 0 when `m` is 0.
    function mulmod(uint256 x, uint256 y, uint256 m) returns (uint256 result);
    /// @notice Sign-extends `x` from `(i + 1) * 8` bits to 256 bits.
    function signextend(uint256 i, uint256 x) returns (uint256 result);

    /// @notice Bitwise NOT of `x`.
    function not(uint256 x) returns (uint256 result);
    /// @notice 1 if `x < y` (unsigned), else 0.
    function lt(uint256 x, uint256 y) returns (uint256 result);
    /// @notice 1 if `x > y` (unsigned), else 0.
    function gt(uint256 x, uint256 y) returns (uint256 result);
    /// @notice 1 if `x < y` (signed), else 0.
    function slt(uint256 x, uint256 y) returns (uint256 result);
    /// @notice 1 if `x > y` (signed), else 0.
    function sgt(uint256 x, uint256 y) returns (uint256 result);
    /// @notice 1 if `x == y`, else 0.
    function eq(uint256 x, uint256 y) returns (uint256 result);
    /// @notice 1 if `x == 0`, else 0.
    function iszero(uint256 x) returns (uint256 result);
    /// @notice Bitwise AND.
    function and(uint256 x, uint256 y) returns (uint256 result);
    /// @notice Bitwise OR.
    function or(uint256 x, uint256 y) returns (uint256 result);
    /// @notice Bitwise XOR.
    function xor(uint256 x, uint256 y) returns (uint256 result);
    /// @notice The `n`-th byte of `x`, counting from the most significant byte (0).
    function byte_(uint256 n, uint256 x) returns (uint256 result);
    /// @notice `y` shifted left by `x` bits.
    function shl(uint256 x, uint256 y) returns (uint256 result);
    /// @notice `y` shifted right (logically) by `x` bits.
    function shr(uint256 x, uint256 y) returns (uint256 result);
    /// @notice `y` shifted right (arithmetically, keeping the sign) by `x` bits.
    function sar(uint256 x, uint256 y) returns (uint256 result);

    /// @notice keccak256 of `mem[p...(p+n))`.
    function keccak256(uint256 p, uint256 n) returns (uint256 hash);

    /// @notice Discards `x`.
    function pop(uint256 x);
    /// @notice Loads the word at `mem[p...(p+32))`.
    function mload(uint256 p) returns (uint256 v);
    /// @notice Stores `v` at `mem[p...(p+32))`.
    function mstore(uint256 p, uint256 v);
    /// @notice Stores the lowest byte of `v` at `mem[p]`.
    function mstore8(uint256 p, uint256 v);
    /// @notice Copies `s` bytes of memory from `f` to `t` (EIP-5656, Cancun).
    function mcopy(uint256 t, uint256 f, uint256 s);
    /// @notice The size of memory used so far: the largest accessed index, rounded up to a word.
    function msize() returns (uint256 size);
    /// @notice Loads `storage[p]`.
    function sload(uint256 p) returns (uint256 v);
    /// @notice Stores `v` in `storage[p]`.
    function sstore(uint256 p, uint256 v);
    /// @notice Loads transient storage slot `p`, which is cleared after the transaction (EIP-1153, Cancun).
    function tload(uint256 p) returns (uint256 v);
    /// @notice Stores `v` in transient storage slot `p`, which is cleared after the transaction (EIP-1153, Cancun).
    function tstore(uint256 p, uint256 v);

    /// @notice The gas still available.
    function gas() returns (uint256 remaining);
    /// @notice The address of the current contract.
    function address() returns (uint256 addr);
    /// @notice The wei balance of address `a`.
    function balance(uint256 a) returns (uint256 v);
    /// @notice The wei balance of the current contract; cheaper than `balance(address())`.
    function selfbalance() returns (uint256 v);
    /// @notice The caller (`msg.sender`), excluding delegatecall.
    function caller() returns (uint256 addr);
    /// @notice The wei sent with the current call (`msg.value`).
    function callvalue() returns (uint256 v);
    /// @notice The calldata word starting at byte `p`.
    function calldataload(uint256 p) returns (uint256 v);
    /// @notice The size of the calldata in bytes.
    function calldatasize() returns (uint256 size);
    /// @notice Copies `s` bytes of calldata from position `f` to memory at `t`.
    function calldatacopy(uint256 t, uint256 f, uint256 s);
    /// @notice The size of the current contract's code.
    function codesize() returns (uint256 size);
    /// @notice Copies `s` bytes of the current code from position `f` to memory at `t`.
    function codecopy(uint256 t, uint256 f, uint256 s);
    /// @notice The size of the code at address `a`.
    function extcodesize(uint256 a) returns (uint256 size);
    /// @notice Like `codecopy(t, f, s)` but for the code at address `a`.
    function extcodecopy(uint256 a, uint256 t, uint256 f, uint256 s);
    /// @notice The hash of the code at address `a`.
    function extcodehash(uint256 a) returns (uint256 hash);
    /// @notice The size of the last call's return data.
    function returndatasize() returns (uint256 size);
    /// @notice Copies `s` bytes of the last call's return data from position `f` to memory at `t`.
    /// Reverts when reading past the end.
    function returndatacopy(uint256 t, uint256 f, uint256 s);

    /// @notice Creates a contract with code `mem[p...(p+n))`, sending `v` wei. Returns its address, or 0 on failure.
    function create(uint256 v, uint256 p, uint256 n) returns (uint256 addr);
    /// @notice Creates a contract at the address determined by `salt` and the code `mem[p...(p+n))`,
    /// sending `v` wei. Returns its address, or 0 on failure.
    function create2(uint256 v, uint256 p, uint256 n, uint256 salt) returns (uint256 addr);
    /// @notice Calls address `a` with input `mem[in...(in+insize))`, `g` gas and `v` wei; the output
    /// goes to `mem[out...(out+outsize))`. Returns 1 on success, 0 on failure.
    function call(uint256 g, uint256 a, uint256 v, uint256 in_, uint256 insize, uint256 out, uint256 outsize) returns (uint256 success);
    /// @notice Like `call`, but runs only the code of `a` in the current contract's context. Prefer `delegatecall`.
    function callcode(uint256 g, uint256 a, uint256 v, uint256 in_, uint256 insize, uint256 out, uint256 outsize) returns (uint256 success);
    /// @notice Like `call`, but runs the code of `a` in the current context, keeping `caller` and `callvalue`.
    function delegatecall(uint256 g, uint256 a, uint256 in_, uint256 insize, uint256 out, uint256 outsize) returns (uint256 success);
    /// @notice Like `call`, but without value and reverting on any state change.
    function staticcall(uint256 g, uint256 a, uint256 in_, uint256 insize, uint256 out, uint256 outsize) returns (uint256 success);
    /// @notice Ends execution and returns `mem[p...(p+s))`.
    function return_(uint256 p, uint256 s);
    /// @notice Ends execution, reverts state changes and returns `mem[p...(p+s))`.
    function revert(uint256 p, uint256 s);
    /// @notice Sends all the contract's Ether to `a`. Since Cancun it only deletes the contract when created
    /// in the same transaction. Deprecated.
    function selfdestruct(uint256 a);
    /// @notice Ends execution with an invalid instruction, consuming all remaining gas.
    function invalid();

    /// @notice Logs `mem[p...(p+s))` with no topics.
    function log0(uint256 p, uint256 s);
    /// @notice Logs `mem[p...(p+s))` with topic `t1`.
    function log1(uint256 p, uint256 s, uint256 t1);
    /// @notice Logs `mem[p...(p+s))` with topics `t1`, `t2`.
    function log2(uint256 p, uint256 s, uint256 t1, uint256 t2);
    /// @notice Logs `mem[p...(p+s))` with topics `t1`, `t2`, `t3`.
    function log3(uint256 p, uint256 s, uint256 t1, uint256 t2, uint256 t3);
    /// @notice Logs `mem[p...(p+s))` with topics `t1`, `t2`, `t3`, `t4`.
    function log4(uint256 p, uint256 s, uint256 t1, uint256 t2, uint256 t3, uint256 t4);

    /// @notice The current chain id.
    function chainid() returns (uint256 id);
    /// @notice The current block's base fee.
    function basefee() returns (uint256 fee);
    /// @notice The current block's blob base fee (Cancun).
    function blobbasefee() returns (uint256 fee);
    /// @notice The transaction's sender (`tx.origin`).
    function origin() returns (uint256 addr);
    /// @notice The transaction's gas price.
    function gasprice() returns (uint256 price);
    /// @notice The hash of block `b`, for the 256 most recent blocks excluding the current one; else 0.
    function blockhash(uint256 b) returns (uint256 hash);
    /// @notice The versioned hash of the transaction's `i`-th blob, or 0 (Cancun).
    function blobhash(uint256 i) returns (uint256 hash);
    /// @notice The current block's proposer.
    function coinbase() returns (uint256 addr);
    /// @notice The current block's timestamp in seconds since the epoch.
    function timestamp() returns (uint256 t);
    /// @notice The current block number.
    function number() returns (uint256 n);
    /// @notice Since Paris an alias of `prevrandao`; deprecated.
    function difficulty() returns (uint256 d);
    /// @notice Randomness from the beacon chain (EIP-4399).
    function prevrandao() returns (uint256 r);
    /// @notice The current block's gas limit.
    function gaslimit() returns (uint256 limit);

    /// @notice Returns `size` and tells the optimizer the memory below it is safe to move stack
    /// variables into. Used for the free memory pointer.
    function memoryguard(uint256 size) returns (uint256 ptr);
}
