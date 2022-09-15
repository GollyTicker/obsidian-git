# Line Authoring Feature

todo.

Looking into the proper way how CodeMirror works, we can see
that we need state, facet, transactions, etc. to make transactions
whenever the git-blame resuls are out, and dispatch them to the view
for the updated gutter.

We could use a state-field to store the current line-author information.
Whenever we get the async result from git-blame, we can then issue a transaction
to update the line-author state-field.
It then is responsible via the GutterMarker or a ViewPlugin to simply display the
current computed line-author state-field.

State Field: https://codemirror.net/docs/ref/#state.StateField
Transaction: https://codemirror.net/docs/ref/#state.Transaction
Create transaction: https://codemirror.net/docs/ref/#state.EditorState.update
We can store the hash of the new git-blame information in an annotation type.
https://codemirror.net/docs/ref/#state.Annotation


---

Document this workflow somewhere.

tracked changes within obsidian -> initiate computation | done

computation finished -> publish new value to subscribers for the finished file | done

editors subscribe to their file at startup | done

subscribed editors update their internal state | done

state/editor update -> gutter can get new value | done.

---

note. line authorinfo only in surce and live preview mode.
